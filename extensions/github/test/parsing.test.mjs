import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateExtensionManifest } from '@terminay/extension-api';
import {
	buildQuery,
	checkRunState,
	chunkBranches,
	createCliTokenStore,
	createGitHubProbe,
	environmentToken,
	ghHostsPath,
	graphqlEndpoint,
	matchPullRequest,
	parseGhHosts,
	parseRemoteUrl,
	statusState,
	toChecks,
	tokenPageUrl,
	toProperties,
} from '../dist/index.js';

const manifest = JSON.parse(
	await readFile(new URL('../package.json', import.meta.url), 'utf8'),
).terminay;

test('the manifest contributes one worktree insight source under worktree-observation', () => {
	assert.equal(validateExtensionManifest(manifest).ok, true);
	assert.equal(manifest.id, 'com.terminay.github');
	assert.deepEqual(manifest.permissions, ['network', 'worktree-observation']);
	assert.equal(
		manifest.contributes.worktreeInsights[0].id,
		'com.terminay.github/github',
	);
});

test('github.com and Enterprise remotes resolve to an HTTPS origin and owner/repo', () => {
	const cases = [
		['git@github.com:owner/repo.git', 'https://github.com'],
		['ssh://git@github.com/owner/repo.git', 'https://github.com'],
		['https://github.com/owner/repo', 'https://github.com'],
		['https://GitHub.com/owner/repo.git', 'https://github.com'],
		['git@ghe.example.com:owner/repo.git', 'https://ghe.example.com'],
		[
			'ssh://git@ghe.example.com:2222/owner/repo.git',
			'https://ghe.example.com',
		],
		[
			'https://ghe.example.com:8443/owner/repo.git',
			'https://ghe.example.com:8443',
		],
	];
	for (const [url, origin] of cases)
		assert.deepEqual(
			parseRemoteUrl(url),
			{ origin, owner: 'owner', repo: 'repo' },
			url,
		);
	assert.equal(parseRemoteUrl('https://github.com/owner'), undefined);
	assert.equal(parseRemoteUrl('/local/path'), undefined);
});

test('API and token pages differ between github.com and Enterprise', () => {
	assert.equal(
		graphqlEndpoint('https://github.com'),
		'https://api.github.com/graphql',
	);
	assert.equal(
		graphqlEndpoint('https://ghe.example.com'),
		'https://ghe.example.com/api/graphql',
	);
	assert.equal(
		tokenPageUrl('https://github.com'),
		'https://github.com/settings/personal-access-tokens/new',
	);
	assert.equal(
		tokenPageUrl('https://ghe.example.com'),
		'https://ghe.example.com/settings/tokens',
	);
});

function probeResponse(status, { headers = {}, body } = {}) {
	return {
		status,
		ok: status >= 200 && status < 300,
		headers: { get: (name) => headers[name.toLowerCase()] ?? null },
		json: async () => body,
	};
}

test('github.com is never probed; Enterprise is detected by header or installed_version', async () => {
	const calls = [];
	const answers = {
		'https://ghe.example.com': probeResponse(200, {
			body: { installed_version: '3.14.0' },
		}),
		'https://private.example.com': probeResponse(401, {
			headers: { 'x-github-enterprise-version': '3.14.0' },
		}),
		'https://gitea.example.com': probeResponse(404, {
			body: { message: 'Not found' },
		}),
	};
	const probe = createGitHubProbe({
		fetch: async (url) => {
			calls.push(url);
			const origin = new URL(url).origin;
			const answer = answers[origin];
			if (answer === undefined) throw new Error('unreachable');
			return answer;
		},
	});
	const signal = new AbortController().signal;
	assert.equal(await probe.isGitHub('https://github.com', signal), true);
	assert.equal(await probe.isGitHub('https://ghe.example.com', signal), true);
	assert.equal(
		await probe.isGitHub('https://private.example.com', signal),
		true,
	);
	assert.equal(
		await probe.isGitHub('https://gitea.example.com', signal),
		false,
	);
	assert.equal(
		await probe.isGitHub('https://down.example.com', signal),
		undefined,
	);
	assert.equal(await probe.isGitHub('https://ghe.example.com', signal), true);
	assert.deepEqual(calls, [
		'https://ghe.example.com/api/v3/meta',
		'https://private.example.com/api/v3/meta',
		'https://gitea.example.com/api/v3/meta',
		'https://down.example.com/api/v3/meta',
	]);
});

test('an unreachable host is asked again only after ten minutes', async () => {
	let now = 0;
	let calls = 0;
	const probe = createGitHubProbe({
		now: () => now,
		fetch: async () => {
			calls += 1;
			throw new Error('unreachable');
		},
	});
	const signal = new AbortController().signal;
	await probe.isGitHub('https://down.example.com', signal);
	now = 9 * 60_000;
	await probe.isGitHub('https://down.example.com', signal);
	assert.equal(calls, 1);
	now = 11 * 60_000;
	await probe.isGitHub('https://down.example.com', signal);
	assert.equal(calls, 2);
});

test('hosts.yml lives where gh keeps it', () => {
	assert.equal(
		ghHostsPath({
			env: { GH_CONFIG_DIR: '/cfg' },
			platform: 'darwin',
			home: '/h',
		}),
		'/cfg/hosts.yml',
	);
	assert.equal(
		ghHostsPath({
			env: { XDG_CONFIG_HOME: '/x' },
			platform: 'linux',
			home: '/h',
		}),
		'/x/gh/hosts.yml',
	);
	assert.equal(
		ghHostsPath({ env: {}, platform: 'darwin', home: '/h' }),
		'/h/.config/gh/hosts.yml',
	);
	assert.match(
		ghHostsPath({
			env: { AppData: 'C:\\AppData' },
			platform: 'win32',
			home: 'C:\\h',
		}),
		/GitHub CLI.hosts\.yml$/,
	);
});

const HOSTS_YML = `github.com:
    users:
        markwylde:
            oauth_token: gho_multi
    git_protocol: ssh
    oauth_token: gho_active
    user: markwylde
ghe.example.com:
    users:
        mark:
    git_protocol: https
    user: mark
legacy.example.com:
    user: other
    users:
        other:
            oauth_token: "gho_nested"   # quoted
`;

test('hosts.yml yields the active token, or a keychain-backed listing', () => {
	const hosts = parseGhHosts(HOSTS_YML);
	assert.deepEqual(hosts.get('github.com'), { token: 'gho_active' });
	assert.deepEqual(hosts.get('ghe.example.com'), {});
	assert.deepEqual(hosts.get('legacy.example.com'), { token: 'gho_nested' });
	assert.equal(hosts.has('elsewhere.example.com'), false);
	assert.equal(parseGhHosts('not: [valid').size, 1);
	assert.equal(parseGhHosts('').size, 0);
});

test('environment tokens follow gh precedence per host kind', () => {
	const env = {
		GH_TOKEN: 'gh',
		GITHUB_TOKEN: 'github',
		GITHUB_ENTERPRISE_TOKEN: 'enterprise',
	};
	assert.equal(environmentToken('https://github.com', env), 'gh');
	assert.equal(
		environmentToken('https://github.com', { GITHUB_TOKEN: 'github' }),
		'github',
	);
	assert.equal(environmentToken('https://ghe.example.com', env), 'enterprise');
	assert.equal(
		environmentToken('https://ghe.example.com', { GH_TOKEN: 'gh' }),
		undefined,
	);
});

function cliStore({ env = {}, text = HOSTS_YML, ghTokens = {} } = {}) {
	const spawns = [];
	let onChange;
	let reads = 0;
	const store = createCliTokenStore({
		env,
		path: '/hosts.yml',
		readFile: async () => {
			reads += 1;
			if (text === null) throw new Error('ENOENT');
			return text;
		},
		watch: (_path, listener) => {
			onChange = listener;
			return { close() {} };
		},
		ghToken: async (host) => {
			spawns.push(host);
			return ghTokens[host];
		},
	});
	return {
		store,
		spawns,
		reads: () => reads,
		change(next) {
			text = next;
			onChange();
		},
	};
}

test('an environment token wins and a rejected one falls through to hosts.yml', async () => {
	const { store, spawns } = cliStore({ env: { GH_TOKEN: 'env' } });
	assert.equal(await store.token('https://github.com'), 'env');
	store.reject('https://github.com');
	assert.equal(await store.token('https://github.com'), 'gho_active');
	assert.deepEqual(spawns, []);
});

test('a token in hosts.yml is used without running gh, and the file is read once', async () => {
	const { store, spawns, reads } = cliStore();
	for (let index = 0; index < 5; index += 1)
		assert.equal(await store.token('https://github.com'), 'gho_active');
	assert.deepEqual(spawns, []);
	assert.equal(reads(), 1);
});

test('a keychain-backed host runs gh auth token once across many refreshes', async () => {
	const { store, spawns } = cliStore({
		ghTokens: { 'ghe.example.com': 'gho_keychain' },
	});
	for (let index = 0; index < 20; index += 1)
		assert.equal(await store.token('https://ghe.example.com'), 'gho_keychain');
	assert.deepEqual(spawns, ['ghe.example.com']);
});

test('a host gh does not list never runs gh', async () => {
	const { store, spawns } = cliStore();
	assert.equal(await store.token('https://other.example.com'), undefined);
	const missing = cliStore({ text: null });
	assert.equal(await missing.store.token('https://github.com'), undefined);
	assert.deepEqual([...spawns, ...missing.spawns], []);
});

test('a failed gh run is remembered until hosts.yml changes', async () => {
	const { store, spawns, change } = cliStore();
	assert.equal(await store.token('https://ghe.example.com'), undefined);
	assert.equal(await store.token('https://ghe.example.com'), undefined);
	assert.deepEqual(spawns, ['ghe.example.com']);
	change(HOSTS_YML);
	await store.token('https://ghe.example.com');
	assert.deepEqual(spawns, ['ghe.example.com', 'ghe.example.com']);
});

test('a rejected gh token asks gh once more, and a token still rejected costs no further spawns', async () => {
	const { store, spawns, change } = cliStore({
		ghTokens: { 'ghe.example.com': 'gho_stale' },
	});
	assert.equal(await store.token('https://ghe.example.com'), 'gho_stale');
	store.reject('https://ghe.example.com');
	await Promise.resolve();
	for (let index = 0; index < 10; index += 1)
		assert.equal(await store.token('https://ghe.example.com'), undefined);
	assert.deepEqual(spawns, ['ghe.example.com', 'ghe.example.com']);
	change(HOSTS_YML);
	assert.equal(await store.token('https://ghe.example.com'), 'gho_stale');
	assert.equal(spawns.length, 3);
});

test('a rejected hosts.yml token is not offered again until the file changes', async () => {
	const { store, change } = cliStore();
	assert.equal(await store.token('https://github.com'), 'gho_active');
	store.reject('https://github.com');
	assert.equal(await store.token('https://github.com'), undefined);
	change(HOSTS_YML.replace('gho_active', 'gho_new'));
	assert.equal(await store.token('https://github.com'), 'gho_new');
});

test('the query carries branch names as variables, one aliased ref each', () => {
	const request = buildQuery('owner', 'repo', ['main', 'feat/"quote"']);
	assert.deepEqual(request.variables, {
		owner: 'owner',
		name: 'repo',
		b0: 'refs/heads/main',
		b1: 'refs/heads/feat/"quote"',
	});
	assert.deepEqual(
		[...request.aliases],
		[
			['main', 'b0'],
			['feat/"quote"', 'b1'],
		],
	);
	assert.doesNotMatch(request.query, /quote/);
	assert.match(request.query, /b1: ref\(qualifiedName: \$b1\)/);
	assert.match(request.query, /checkRunCountsByState/);
	assert.match(
		request.query,
		/mergedPullRequests: pullRequests\(states: MERGED, first: 50, orderBy: \{field: UPDATED_AT, direction: DESC\}\)/,
	);
	assert.doesNotMatch(
		buildQuery('owner', 'repo', ['main'], { counts: false }).query,
		/CountsByState/,
	);
	const many = Array.from({ length: 120 }, (_, index) => `b${index}`);
	assert.deepEqual(
		chunkBranches(many).map((chunk) => chunk.length),
		[50, 50, 20],
	);
});

test('check run and status states map to check states', () => {
	const runs = {
		SUCCESS: 'passed',
		FAILURE: 'failed',
		TIMED_OUT: 'failed',
		CANCELLED: 'failed',
		STARTUP_FAILURE: 'failed',
		ACTION_REQUIRED: 'failed',
		NEUTRAL: 'skipped',
		SKIPPED: 'skipped',
		STALE: 'skipped',
		IN_PROGRESS: 'pending',
		QUEUED: 'pending',
	};
	for (const [state, expected] of Object.entries(runs))
		assert.equal(checkRunState(state), expected, state);
	const statuses = {
		SUCCESS: 'passed',
		FAILURE: 'failed',
		ERROR: 'failed',
		PENDING: 'pending',
		EXPECTED: 'pending',
	};
	for (const [state, expected] of Object.entries(statuses))
		assert.equal(statusState(state), expected, state);
});

const run = (
	name,
	status,
	conclusion,
	detailsUrl = `https://github.com/owner/repo/actions/runs/${name}`,
) => ({
	__typename: 'CheckRun',
	name,
	status,
	conclusion,
	detailsUrl,
});

test('Actions check runs and commit statuses combine, failures first', () => {
	const checks = toChecks({
		statusCheckRollup: {
			contexts: {
				totalCount: 3,
				checkRunCountsByState: [
					{ state: 'SUCCESS', count: 1 },
					{ state: 'IN_PROGRESS', count: 1 },
				],
				statusContextCountsByState: [{ state: 'FAILURE', count: 1 }],
				nodes: [
					run('build', 'COMPLETED', 'SUCCESS'),
					run('e2e', 'IN_PROGRESS', null),
					{
						__typename: 'StatusContext',
						context: 'ci/legacy',
						state: 'FAILURE',
						targetUrl: 'https://ci.example.com/1',
					},
				],
			},
		},
	});
	assert.deepEqual(checks, {
		passed: 1,
		failed: 1,
		pending: 1,
		skipped: 0,
		total: 3,
		items: [
			{ name: 'ci/legacy', state: 'failed', url: 'https://ci.example.com/1' },
			{
				name: 'e2e',
				state: 'pending',
				url: 'https://github.com/owner/repo/actions/runs/e2e',
			},
			{
				name: 'build',
				state: 'passed',
				url: 'https://github.com/owner/repo/actions/runs/build',
			},
		],
	});
});

test('counts cover every check past the listed items, and unsafe links are dropped', () => {
	const checks = toChecks({
		statusCheckRollup: {
			contexts: {
				totalCount: 150,
				checkRunCountsByState: [{ state: 'SUCCESS', count: 150 }],
				statusContextCountsByState: [],
				nodes: Array.from({ length: 100 }, (_, index) =>
					run(
						`job ${index}`,
						'COMPLETED',
						'SUCCESS',
						'http://insecure.example.com',
					),
				),
			},
		},
	});
	assert.equal(checks.total, 150);
	assert.equal(checks.passed, 150);
	assert.equal(checks.items.length, 100);
	assert.equal(checks.items[0].url, undefined);
});

test('without per-state totals the listed items are counted', () => {
	const checks = toChecks({
		statusCheckRollup: {
			contexts: {
				nodes: [run('a', 'COMPLETED', 'SKIPPED'), run('b', 'QUEUED', null)],
			},
		},
	});
	assert.equal(checks.skipped, 1);
	assert.equal(checks.pending, 1);
	assert.equal(checks.total, 2);
	assert.equal(toChecks({ statusCheckRollup: null }), undefined);
});

const pull = (overrides = {}) => ({
	number: 42,
	title: 'feat: things',
	url: 'https://github.com/owner/repo/pull/42',
	isDraft: false,
	mergeable: 'MERGEABLE',
	headRefName: 'feat/x',
	headRepository: { nameWithOwner: 'Owner/Repo' },
	commits: {
		nodes: [
			{
				commit: {
					statusCheckRollup: {
						contexts: { nodes: [run('build', 'COMPLETED', 'FAILURE')] },
					},
				},
			},
		],
	},
	...overrides,
});

test('a worktree matches its own repository pull request, not a fork', () => {
	const fork = pull({
		number: 7,
		headRepository: { nameWithOwner: 'someone/repo' },
	});
	const ref = { associatedPullRequests: { nodes: [fork, pull()] } };
	assert.equal(matchPullRequest(ref, 'feat/x', 'owner', 'repo')?.number, 42);
	assert.equal(
		matchPullRequest(
			{ associatedPullRequests: { nodes: [fork] } },
			'feat/x',
			'owner',
			'repo',
		),
		undefined,
	);
});

test('a pull request publishes its draft state, mergeability, and head checks', () => {
	const ref = {
		target: {
			statusCheckRollup: {
				contexts: { nodes: [run('branch', 'COMPLETED', 'SUCCESS')] },
			},
		},
		associatedPullRequests: {
			nodes: [pull({ isDraft: true, mergeable: 'CONFLICTING' })],
		},
	};
	const properties = toProperties(ref, 'feat/x', 'owner', 'repo');
	assert.deepEqual(properties.pullRequest, {
		number: 42,
		title: 'feat: things',
		url: 'https://github.com/owner/repo/pull/42',
		state: 'draft',
		mergeable: false,
	});
	assert.equal(properties.checks.failed, 1);
	assert.equal(properties.checks.items[0].name, 'build');
	const unknown = toProperties(
		{
			associatedPullRequests: {
				nodes: [pull({ mergeable: 'UNKNOWN', commits: null })],
			},
		},
		'feat/x',
		'owner',
		'repo',
	);
	assert.equal('mergeable' in unknown.pullRequest, false);
	assert.equal(unknown.pullRequest.state, 'open');
});

test('a branch without a pull request publishes its own checks; a missing branch nothing', () => {
	const ref = {
		target: {
			statusCheckRollup: {
				contexts: { nodes: [run('main', 'COMPLETED', 'SUCCESS')] },
			},
		},
		associatedPullRequests: { nodes: [] },
	};
	assert.deepEqual(toProperties(ref, 'main', 'owner', 'repo'), {
		checks: {
			passed: 1,
			failed: 0,
			pending: 0,
			skipped: 0,
			total: 1,
			items: [
				{
					name: 'main',
					state: 'passed',
					url: 'https://github.com/owner/repo/actions/runs/main',
				},
			],
		},
	});
	assert.equal(toProperties(null, 'gone', 'owner', 'repo'), null);
});

test('a merged pull request is matched when no open one is, even with its branch gone', () => {
	const branch = {
		target: {
			statusCheckRollup: {
				contexts: { nodes: [run('branch', 'COMPLETED', 'SUCCESS')] },
			},
		},
		associatedPullRequests: { nodes: [] },
	};
	const merged = (number, overrides = {}) => ({
		number,
		title: `PR ${number}`,
		url: `https://github.com/owner/repo/pull/${number}`,
		headRefName: 'feat/x',
		headRepository: { nameWithOwner: 'owner/repo' },
		...overrides,
	});
	const fork = merged(9, { headRepository: { nameWithOwner: 'someone/repo' } });
	const list = [fork, merged(51), merged(40)];
	const present = toProperties(branch, 'feat/x', 'owner', 'repo', list);
	assert.deepEqual(present.pullRequest, {
		number: 51,
		title: 'PR 51',
		url: 'https://github.com/owner/repo/pull/51',
		state: 'merged',
	});
	assert.equal(present.checks.passed, 1);
	assert.deepEqual(toProperties(null, 'feat/x', 'owner', 'repo', list), {
		pullRequest: {
			number: 51,
			title: 'PR 51',
			url: 'https://github.com/owner/repo/pull/51',
			state: 'merged',
		},
	});
	const open = { ...branch, associatedPullRequests: { nodes: [pull()] } };
	assert.equal(
		toProperties(open, 'feat/x', 'owner', 'repo', list).pullRequest.state,
		'open',
	);
	assert.equal(toProperties(null, 'feat/x', 'owner', 'repo', [fork]), null);
});
