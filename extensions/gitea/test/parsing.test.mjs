import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateExtensionManifest } from '@terminay/extension-api';
import {
	checkState,
	createGiteaProbe,
	createTeaTokenStore,
	matchPullRequest,
	parseRemoteUrl,
	parseTeaLogins,
	pickRemote,
	teaConfigPath,
	toChecks,
	toProperties,
} from '../dist/index.js';

const manifest = JSON.parse(
	await readFile(new URL('../package.json', import.meta.url), 'utf8'),
).terminay;

test('the manifest contributes one worktree insight source under worktree-observation', () => {
	assert.equal(validateExtensionManifest(manifest).ok, true);
	assert.equal(manifest.id, 'com.terminay.gitea');
	assert.deepEqual(manifest.permissions, ['network', 'worktree-observation']);
	assert.equal(
		manifest.contributes.worktreeInsights[0].id,
		'com.terminay.gitea/gitea',
	);
});

test('remote URLs resolve to an HTTPS origin and owner/repo', () => {
	const cases = [
		[
			'ssh://git@git.example.net:4222/owner/repo.git',
			{ origin: 'https://git.example.net', owner: 'owner', repo: 'repo' },
		],
		[
			'git@git.example.net:owner/repo.git',
			{ origin: 'https://git.example.net', owner: 'owner', repo: 'repo' },
		],
		[
			'git.example.net:owner/repo',
			{ origin: 'https://git.example.net', owner: 'owner', repo: 'repo' },
		],
		[
			'https://git.example.net/owner/repo.git',
			{ origin: 'https://git.example.net', owner: 'owner', repo: 'repo' },
		],
		[
			'https://Git.Example.net:3000/owner/repo/',
			{ origin: 'https://git.example.net:3000', owner: 'owner', repo: 'repo' },
		],
		[
			'http://git.example.net/owner/repo',
			{ origin: 'https://git.example.net', owner: 'owner', repo: 'repo' },
		],
	];
	for (const [url, expected] of cases)
		assert.deepEqual(parseRemoteUrl(url), expected, url);
	for (const url of [
		'',
		'/local/path/repo',
		'https://host/only-one',
		'https://host/a/b/c',
		'file:///tmp/repo',
	])
		assert.equal(parseRemoteUrl(url), undefined, url);
});

test('the origin remote is preferred, else the first', () => {
	const upstream = { name: 'upstream', url: 'u' };
	const origin = { name: 'origin', url: 'o' };
	assert.equal(pickRemote([upstream, origin]), origin);
	assert.equal(pickRemote([upstream]), upstream);
	assert.equal(pickRemote([]), undefined);
});

const TEA_CONFIG = `logins:
    - name: git.example.net
      url: https://git.example.net
      token: "abc123"
      default: false
      ssh_host: git.example.net
      user: someone
    - name: other
      url: 'https://other.example.org/'
      token: def456 # trailing comment
    - name: no-token
      url: https://empty.example.org
preferences:
    editor: false
`;

test("tea logins are read from the config's logins list", () => {
	assert.deepEqual(parseTeaLogins(TEA_CONFIG), [
		{ url: 'https://git.example.net', token: 'abc123' },
		{ url: 'https://other.example.org/', token: 'def456' },
	]);
	assert.deepEqual(parseTeaLogins('preferences:\n  editor: true\n'), []);
});

test('the tea config path follows XDG, then the platform default', () => {
	assert.equal(
		teaConfigPath({
			env: { XDG_CONFIG_HOME: '/x' },
			platform: 'darwin',
			home: '/h',
		}),
		'/x/tea/config.yml',
	);
	assert.equal(
		teaConfigPath({ env: {}, platform: 'darwin', home: '/h' }),
		'/h/Library/Application Support/tea/config.yml',
	);
	assert.equal(
		teaConfigPath({ env: {}, platform: 'linux', home: '/h' }),
		'/h/.config/tea/config.yml',
	);
});

test('tea tokens are read once, matched by origin, and re-read only on change', async () => {
	let reads = 0;
	let changed;
	const store = createTeaTokenStore({
		path: '/fake/config.yml',
		readFile: async () => {
			reads += 1;
			return TEA_CONFIG;
		},
		watch: (_path, onChange) => {
			changed = onChange;
			return { close() {} };
		},
	});
	assert.equal(await store.token('https://git.example.net'), 'abc123');
	assert.equal(await store.token('https://other.example.org'), 'def456');
	assert.equal(await store.token('https://unknown.example'), undefined);
	assert.equal(reads, 1);
	store.reject('https://git.example.net');
	assert.equal(await store.token('https://git.example.net'), undefined);
	changed();
	assert.equal(await store.token('https://git.example.net'), 'abc123');
	assert.equal(reads, 2);
});

test('a missing tea config yields no tokens', async () => {
	const store = createTeaTokenStore({
		path: '/missing',
		readFile: async () => {
			throw new Error('ENOENT');
		},
	});
	assert.equal(await store.token('https://git.example.net'), undefined);
});

test('the probe treats a version answer as Gitea and caches the verdict', async () => {
	let calls = 0;
	const probe = createGiteaProbe({
		fetch: async (url) => {
			calls += 1;
			assert.equal(url, 'https://git.example.net/api/v1/version');
			return {
				ok: true,
				status: 200,
				json: async () => ({ version: '1.27.3' }),
			};
		},
	});
	const signal = new AbortController().signal;
	assert.equal(await probe.isGitea('https://git.example.net', signal), true);
	assert.equal(await probe.isGitea('https://git.example.net', signal), true);
	assert.equal(calls, 1);
});

test('the probe says no to non-Gitea servers and unknown when unreachable', async () => {
	const signal = new AbortController().signal;
	const notGitea = createGiteaProbe({
		fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
	});
	assert.equal(await notGitea.isGitea('https://github.com', signal), false);
	let now = 0;
	let calls = 0;
	const unreachable = createGiteaProbe({
		now: () => now,
		fetch: async () => {
			calls += 1;
			throw new Error('ECONNREFUSED');
		},
	});
	assert.equal(
		await unreachable.isGitea('https://down.example', signal),
		undefined,
	);
	assert.equal(
		await unreachable.isGitea('https://down.example', signal),
		undefined,
	);
	assert.equal(calls, 1);
	now = 10 * 60_000;
	await unreachable.isGitea('https://down.example', signal);
	assert.equal(calls, 2);
});

const worktree = (branch, upstream = branch) => ({
	id: `wt-${branch}`,
	path: `/repo/${branch}`,
	branch,
	upstream: upstream === null ? null : { remote: 'origin', branch: upstream },
	head: '0'.repeat(40),
});

test('a pull request matches by upstream branch, else branch name, in the same repository', () => {
	const pulls = [
		{ number: 1, head: { ref: 'feat/a', repo: { full_name: 'fork/repo' } } },
		{ number: 2, head: { ref: 'feat/a', repo: { full_name: 'Owner/Repo' } } },
		{ number: 3, head: { ref: 'feat/b' } },
	];
	assert.equal(
		matchPullRequest(pulls, worktree('feat/a'), 'owner', 'repo').number,
		2,
	);
	assert.equal(
		matchPullRequest(pulls, worktree('feat/b'), 'owner', 'repo').number,
		3,
	);
	assert.equal(
		matchPullRequest(pulls, worktree('feat/c'), 'owner', 'repo'),
		undefined,
	);
	assert.equal(
		matchPullRequest(pulls, worktree('feat/a', null), 'owner', 'repo').number,
		2,
	);
	assert.equal(
		matchPullRequest(pulls, worktree('local', 'feat/b'), 'owner', 'repo')
			.number,
		3,
		'a configured upstream wins over the branch name',
	);
	assert.equal(
		matchPullRequest(
			pulls,
			{ ...worktree('feat/a', null), branch: null },
			'owner',
			'repo',
		),
		undefined,
	);
});

test('status states map to check states', () => {
	assert.equal(checkState('success'), 'passed');
	assert.equal(checkState('failure'), 'failed');
	assert.equal(checkState('error'), 'failed');
	assert.equal(checkState('pending'), 'pending');
	assert.equal(checkState('skipped'), 'skipped');
	assert.equal(checkState('warning'), 'skipped');
	assert.equal(checkState('mystery'), 'pending');
});

test('pull requests map to open or draft with a safe URL', () => {
	const base = {
		number: 7,
		title: 'feat: x',
		html_url: 'https://git.example.net/o/r/pulls/7',
		mergeable: true,
	};
	assert.deepEqual(toProperties(base, []).pullRequest, {
		number: 7,
		title: 'feat: x',
		url: base.html_url,
		state: 'open',
		mergeable: true,
	});
	assert.equal(
		toProperties({ ...base, draft: true }, []).pullRequest.state,
		'draft',
	);
	assert.equal(
		toProperties({ ...base, title: 'WIP: feat' }, []).pullRequest.state,
		'draft',
	);
	assert.equal(
		toProperties({ ...base, title: '[WIP] feat' }, []).pullRequest.state,
		'draft',
	);
	assert.equal(
		toProperties({ ...base, html_url: 'http://insecure/7' }, []),
		null,
	);
	assert.equal(toProperties(undefined, []), null);
});

test('checks count every status and keep failures first when truncating', () => {
	const statuses = [
		...Array.from({ length: 120 }, (_, index) => ({
			context: `ok ${index}`,
			status: 'success',
			target_url: 'https://git.example.net/run',
		})),
		{
			context: 'broken',
			status: 'failure',
			target_url: 'https://git.example.net/run/broken',
		},
		{
			context: 'waiting',
			status: 'pending',
			target_url: 'javascript:alert(1)',
		},
	];
	const checks = toChecks(statuses);
	assert.equal(checks.total, 122);
	assert.equal(checks.passed, 120);
	assert.equal(checks.failed, 1);
	assert.equal(checks.pending, 1);
	assert.equal(checks.items.length, 100);
	assert.equal(checks.items[0].name, 'broken');
	assert.equal(checks.items[1].name, 'waiting');
	assert.equal(checks.items[1].url, undefined);
	assert.equal(toChecks([]), undefined);
});

test('Gitea Actions status paths resolve against the origin', () => {
	const checks = toChecks(
		[
			{ context: 'CI / Build', status: 'success', target_url: '/owner/repo/actions/runs/1/jobs/0' },
			{ context: 'CI / Protocol-relative', status: 'success', target_url: '//evil.example/x' },
		],
		'https://git.example.net',
	);
	assert.equal(checks.items[0].url, 'https://git.example.net/owner/repo/actions/runs/1/jobs/0');
	assert.equal(checks.items[1].url, undefined);
});
