import assert from 'node:assert/strict';
import test from 'node:test';
import {
	ACTIVE_REFRESH_INTERVAL_MS,
	createGiteaInsightRuntime,
	FAILURE_BACKOFF_MS,
	INACTIVE_REFRESH_INTERVAL_MS,
} from '../dist/index.js';

const ORIGIN = 'https://git.example.net';

function fakeClock() {
	let now = 0;
	let nextId = 0;
	const timers = new Map();
	return {
		setTimeout(callback, delay) {
			const id = ++nextId;
			timers.set(id, { at: now + delay, callback });
			return id;
		},
		clearTimeout(id) {
			timers.delete(id);
		},
		pending: () => [...timers.values()].map((timer) => timer.at - now),
		async advance(ms) {
			now += ms;
			for (const [id, timer] of [...timers]) {
				if (timer.at <= now) {
					timers.delete(id);
					timer.callback();
				}
			}
			await settle();
		},
	};
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
async function flush() {
	for (let index = 0; index < 10; index += 1) await settle();
}

function response(status, body) {
	return { status, ok: status >= 200 && status < 300, json: async () => body };
}

function fakeGitea({ tokens = ['tea-token'], statuses = {}, pulls } = {}) {
	const calls = [];
	const fetch = async (url, init) => {
		calls.push({ url, authorization: init?.headers?.authorization });
		const token = init?.headers?.authorization?.replace(/^token /, '');
		if (!tokens.includes(token))
			return response(401, { message: 'unauthorized' });
		if (url.includes('/pulls?'))
			return response(
				200,
				pulls ?? [
					{
						number: 285,
						title: 'feat: about',
						html_url: `${ORIGIN}/owner/repo/pulls/285`,
						head: {
							ref: 'feat/about',
							sha: 'abc',
							repo: { full_name: 'owner/repo' },
						},
					},
				],
			);
		const match = /\/commits\/([^/]+)\/status/.exec(url);
		if (match) {
			const ref = decodeURIComponent(match[1]);
			return response(200, { state: 'pending', statuses: statuses[ref] ?? [] });
		}
		return response(404, {});
	};
	return { fetch, calls };
}

function context(overrides = {}) {
	return {
		id: 'ctx-1',
		repositoryRoot: '/repo',
		remotes: [
			{ name: 'origin', url: 'ssh://git@git.example.net:4222/owner/repo.git' },
		],
		worktrees: [
			{
				id: 'wt-main',
				path: '/repo',
				branch: 'main',
				upstream: { remote: 'origin', branch: 'main' },
				head: '1',
			},
			{
				id: 'wt-about',
				path: '/repo-about',
				branch: 'feat/about',
				upstream: { remote: 'origin', branch: 'feat/about' },
				head: '2',
			},
			{
				id: 'wt-local',
				path: '/repo-local',
				branch: 'local',
				upstream: null,
				head: '3',
			},
			{
				id: 'wt-detached',
				path: '/repo-detached',
				branch: null,
				upstream: null,
				head: '4',
			},
		],
		...overrides,
	};
}

function harness({
	gitea = fakeGitea(),
	teaToken = 'tea-token',
	storedToken,
	isGitea = true,
	contexts = [context()],
} = {}) {
	const clock = fakeClock();
	const controller = new AbortController();
	const published = [];
	const signIns = [];
	const rejected = [];
	const teaRejected = [];
	let contextListener;
	let availableListener;
	let stored = storedToken;
	let tea = teaToken ?? undefined;
	const runtime = createGiteaInsightRuntime({
		fetch: gitea.fetch,
		clock,
		probe: { isGitea: async () => isGitea },
		tea: {
			token: async () => tea,
			reject: (origin) => {
				teaRejected.push(origin);
				tea = undefined;
			},
			dispose() {},
		},
	});
	runtime.start({
		contexts,
		signal: controller.signal,
		onContextsChanged(listener) {
			contextListener = listener;
			return { dispose() {} };
		},
		publisher: {
			publish: (contextId, worktreeId, properties) =>
				published.push({ contextId, worktreeId, properties }),
			requestSignIn: (request) => signIns.push(request),
		},
		credentials: {
			token: async () => stored,
			reject: async (origin) => {
				rejected.push(origin);
				stored = undefined;
			},
			onAvailable(listener) {
				availableListener = listener;
				return { dispose() {} };
			},
		},
	});
	return {
		clock,
		controller,
		published,
		signIns,
		rejected,
		teaRejected,
		gitea,
		setContexts: (next) => contextListener(next),
		storeToken: (token) => {
			stored = token;
			availableListener(ORIGIN);
		},
	};
}

test('one refresh is one pull request listing plus one status per worktree on a branch', async () => {
	const gitea = fakeGitea({
		statuses: {
			abc: [
				{
					context: 'CI / Build',
					status: 'failure',
					target_url: `${ORIGIN}/owner/repo/actions/runs/1`,
				},
				{ context: 'CI / Lint', status: 'success' },
			],
		},
	});
	const run = harness({ gitea });
	await flush();
	const urls = gitea.calls.map((call) => call.url);
	assert.equal(urls.filter((url) => url.includes('/pulls?')).length, 1);
	assert.equal(urls.filter((url) => url.includes('/status')).length, 3);
	assert.ok(
		urls.includes(
			`${ORIGIN}/api/v1/repos/owner/repo/commits/abc/status?limit=100`,
		),
		'PR head sha is used',
	);
	assert.ok(
		urls.includes(
			`${ORIGIN}/api/v1/repos/owner/repo/commits/main/status?limit=100`,
		),
		'upstream branch is used without a PR',
	);
	assert.ok(
		urls.includes(
			`${ORIGIN}/api/v1/repos/owner/repo/commits/local/status?limit=100`,
		),
		'a branch without an upstream uses its same-named remote branch',
	);
	assert.ok(
		gitea.calls.every((call) => call.authorization === 'token tea-token'),
	);
	assert.deepEqual(run.published, [
		{
			contextId: 'ctx-1',
			worktreeId: 'wt-about',
			properties: {
				pullRequest: {
					number: 285,
					title: 'feat: about',
					url: `${ORIGIN}/owner/repo/pulls/285`,
					state: 'open',
				},
				checks: {
					passed: 1,
					failed: 1,
					pending: 0,
					skipped: 0,
					total: 2,
					items: [
						{
							name: 'CI / Build',
							state: 'failed',
							url: `${ORIGIN}/owner/repo/actions/runs/1`,
						},
						{ name: 'CI / Lint', state: 'passed' },
					],
				},
			},
		},
	]);
	run.controller.abort();
});

test('an idle project refreshes on the 45 second inactive floor and republishes only changes', async () => {
	const run = harness();
	await flush();
	assert.deepEqual(run.clock.pending(), [INACTIVE_REFRESH_INTERVAL_MS]);
	const firstCalls = run.gitea.calls.length;
	const firstPublished = run.published.length;
	await run.clock.advance(INACTIVE_REFRESH_INTERVAL_MS - 1);
	assert.equal(run.gitea.calls.length, firstCalls);
	await run.clock.advance(1);
	await flush();
	assert.equal(run.gitea.calls.length, firstCalls * 2);
	assert.equal(
		run.published.length,
		firstPublished,
		'unchanged properties are not republished',
	);
	run.controller.abort();
});

test('a re-issued context refreshes at once and a cancelled one stops', async () => {
	const run = harness();
	await flush();
	const before = run.gitea.calls.length;
	run.setContexts([
		context({
			worktrees: context().worktrees.map((w) => ({ ...w, head: `${w.head}x` })),
		}),
	]);
	await flush();
	assert.equal(run.gitea.calls.length, before * 2);
	run.setContexts([]);
	assert.deepEqual(run.clock.pending(), []);
	await run.clock.advance(INACTIVE_REFRESH_INTERVAL_MS * 10);
	assert.equal(run.gitea.calls.length, before * 2);
});

test('aborting the source stops every timer and request', async () => {
	const run = harness();
	await flush();
	const calls = run.gitea.calls.length;
	run.controller.abort();
	assert.deepEqual(run.clock.pending(), []);
	await run.clock.advance(INACTIVE_REFRESH_INTERVAL_MS * 10);
	assert.equal(run.gitea.calls.length, calls);
});

test('failures back off and a success resets the interval', async () => {
	let failing = true;
	const gitea = fakeGitea();
	const fetch = async (url, init) =>
		failing ? response(502, {}) : gitea.fetch(url, init);
	const run = harness({ gitea: { fetch, calls: gitea.calls } });
	await flush();
	assert.deepEqual(run.clock.pending(), [FAILURE_BACKOFF_MS[0]]);
	await run.clock.advance(FAILURE_BACKOFF_MS[0]);
	await flush();
	assert.deepEqual(run.clock.pending(), [FAILURE_BACKOFF_MS[1]]);
	failing = false;
	await run.clock.advance(FAILURE_BACKOFF_MS[1]);
	await flush();
	assert.deepEqual(run.clock.pending(), [INACTIVE_REFRESH_INTERVAL_MS]);
	run.controller.abort();
});

test('a non-Gitea repository publishes nothing and requests nothing', async () => {
	const run = harness({ isGitea: false });
	await flush();
	assert.equal(run.gitea.calls.length, 0);
	assert.deepEqual(run.published, []);
	assert.deepEqual(run.signIns, []);
	assert.deepEqual(run.clock.pending(), []);
});

test('with no credential the extension requests sign-in once and refreshes when a token arrives', async () => {
	const run = harness({
		teaToken: null,
		gitea: fakeGitea({ tokens: ['stored-token'] }),
	});
	await flush();
	assert.deepEqual(run.signIns, [
		{
			origin: ORIGIN,
			provider: 'Gitea',
			tokenPageUrl: `${ORIGIN}/user/settings/applications`,
		},
	]);
	assert.equal(run.gitea.calls.length, 0);
	assert.deepEqual(run.clock.pending(), []);
	run.storeToken('stored-token');
	await flush();
	assert.ok(run.gitea.calls.length > 0);
	assert.ok(
		run.gitea.calls.every(
			(call) => call.authorization === 'token stored-token',
		),
	);
	assert.equal(run.published.length, 1);
	run.controller.abort();
});

test('a rejected tea token falls back to the stored token', async () => {
	const run = harness({
		teaToken: 'old-tea',
		storedToken: 'stored-token',
		gitea: fakeGitea({ tokens: ['stored-token'] }),
	});
	await flush();
	assert.deepEqual(run.teaRejected, [ORIGIN]);
	assert.deepEqual(run.rejected, []);
	assert.deepEqual(run.signIns, []);
	assert.equal(run.published.length, 1);
	run.controller.abort();
});

test('a revoked stored token is reported rejected and sign-in is requested again', async () => {
	const run = harness({
		teaToken: null,
		storedToken: 'revoked',
		gitea: fakeGitea({ tokens: [] }),
	});
	await flush();
	assert.deepEqual(run.rejected, [ORIGIN]);
	assert.equal(run.signIns.length, 1);
	assert.deepEqual(run.published, []);
});

test('an active project refreshes every 10 seconds', async () => {
	const run = harness({ contexts: [context({ active: true })] });
	await flush();
	assert.deepEqual(run.clock.pending(), [ACTIVE_REFRESH_INTERVAL_MS]);
	run.controller.abort();
});

test('becoming active refreshes at once; becoming inactive only slows the next refresh', async () => {
	const run = harness();
	await flush();
	const calls = run.gitea.calls.length;
	run.setContexts([context({ active: true })]);
	await flush();
	assert.equal(run.gitea.calls.length, calls * 2, 'focus refreshes immediately');
	assert.deepEqual(run.clock.pending(), [ACTIVE_REFRESH_INTERVAL_MS]);
	run.setContexts([context({ active: false })]);
	await flush();
	assert.equal(run.gitea.calls.length, calls * 2, 'losing focus makes no request');
	await run.clock.advance(ACTIVE_REFRESH_INTERVAL_MS);
	await flush();
	assert.deepEqual(run.clock.pending(), [INACTIVE_REFRESH_INTERVAL_MS]);
	run.controller.abort();
});
