import assert from 'node:assert/strict';
import test from 'node:test';
import {
	ACTIVE_REFRESH_INTERVAL_MS,
	createGitHubInsightRuntime,
	FAILURE_BACKOFF_MS,
	INACTIVE_REFRESH_INTERVAL_MS,
} from '../dist/index.js';

const ORIGIN = 'https://github.com';
const ENDPOINT = 'https://api.github.com/graphql';

function fakeClock() {
	let now = 1_000_000;
	let nextId = 0;
	const timers = new Map();
	return {
		now: () => now,
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
			await flush();
		},
	};
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
async function flush() {
	for (let index = 0; index < 10; index += 1) await settle();
}

function response(status, body, headers = {}) {
	return {
		status,
		ok: status >= 200 && status < 300,
		headers: { get: (name) => headers[name.toLowerCase()] ?? null },
		json: async () => body,
	};
}

const rollup = (...nodes) => ({ statusCheckRollup: { contexts: { nodes } } });
const run = (name, conclusion) => ({
	__typename: 'CheckRun',
	name,
	status: conclusion === null ? 'IN_PROGRESS' : 'COMPLETED',
	conclusion,
	detailsUrl: `https://github.com/owner/repo/actions/runs/${encodeURIComponent(name)}`,
});

/** A GraphQL endpoint answering each aliased ref from `branches`. */
function fakeGitHub({
	tokens = ['cli-token'],
	branches,
	merged = [],
	answer,
} = {}) {
	const calls = [];
	const data = branches ?? {
		main: {
			target: rollup(run('build', 'SUCCESS')),
			associatedPullRequests: { nodes: [] },
		},
		'feat/about': {
			target: rollup(),
			associatedPullRequests: {
				nodes: [
					{
						number: 42,
						title: 'feat: about',
						url: 'https://github.com/owner/repo/pull/42',
						isDraft: false,
						mergeable: 'MERGEABLE',
						headRefName: 'feat/about',
						headRepository: { nameWithOwner: 'owner/repo' },
						commits: {
							nodes: [
								{ commit: rollup(run('build', 'FAILURE'), run('e2e', null)) },
							],
						},
					},
				],
			},
		},
	};
	const fetch = async (url, init) => {
		const body = JSON.parse(init.body);
		calls.push({ url, authorization: init.headers.authorization, body });
		if (answer !== undefined) {
			const custom = answer(calls.length, body);
			if (custom !== undefined) return custom;
		}
		const token = init.headers.authorization.replace(/^bearer /, '');
		if (!tokens.includes(token))
			return response(401, { message: 'Bad credentials' });
		const repository = {
			nameWithOwner: 'owner/repo',
			mergedPullRequests: { nodes: merged },
		};
		for (const [name, value] of Object.entries(body.variables))
			if (/^b\d+$/.test(name))
				repository[name] = data[value.replace(/^refs\/heads\//, '')] ?? null;
		return response(200, {
			data: {
				rateLimit: { remaining: 4999, resetAt: '2030-01-01T00:00:00Z' },
				repository,
			},
		});
	};
	return { fetch, calls };
}

function context(overrides = {}) {
	return {
		id: 'ctx-1',
		repositoryRoot: '/repo',
		remotes: [{ name: 'origin', url: 'git@github.com:owner/repo.git' }],
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
	github = fakeGitHub(),
	cliToken = 'cli-token',
	storedToken,
	isGitHub = true,
	contexts = [context()],
} = {}) {
	const clock = fakeClock();
	const controller = new AbortController();
	const published = [];
	const signIns = [];
	const rejected = [];
	const cliRejected = [];
	let contextListener;
	let availableListener;
	let stored = storedToken;
	let cli = cliToken ?? undefined;
	const runtime = createGitHubInsightRuntime({
		fetch: github.fetch,
		clock,
		probe: { isGitHub: async () => isGitHub },
		cli: {
			token: async () => cli,
			reject: (origin) => {
				cliRejected.push(origin);
				cli = undefined;
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
		cliRejected,
		github,
		setContexts: (next) => contextListener(next),
		storeToken: (token) => {
			stored = token;
			availableListener(ORIGIN);
		},
	};
}

test('one refresh is one GraphQL request for every branched worktree', async () => {
	const h = harness({
		contexts: [
			context({
				worktrees: [
					...['a', 'b', 'c', 'd', 'e'].map((branch, index) => ({
						id: `wt-${branch}`,
						path: `/repo-${branch}`,
						branch,
						upstream: { remote: 'origin', branch },
						head: String(index),
					})),
					{
						id: 'wt-detached',
						path: '/d',
						branch: null,
						upstream: null,
						head: '9',
					},
				],
			}),
		],
	});
	await flush();
	assert.equal(h.github.calls.length, 1);
	const [call] = h.github.calls;
	assert.equal(call.url, ENDPOINT);
	assert.equal(call.authorization, 'bearer cli-token');
	assert.deepEqual(
		Object.keys(call.body.variables).filter((name) => /^b\d+$/.test(name))
			.length,
		5,
	);
});

test('worktrees publish their pull request and checks, others nothing', async () => {
	const h = harness();
	await flush();
	const byId = Object.fromEntries(
		h.published.map((entry) => [entry.worktreeId, entry.properties]),
	);
	assert.deepEqual(Object.keys(byId).sort(), ['wt-about', 'wt-main']);
	assert.equal(byId['wt-about'].pullRequest.number, 42);
	assert.equal(byId['wt-about'].pullRequest.mergeable, true);
	assert.equal(byId['wt-about'].checks.failed, 1);
	assert.equal(byId['wt-about'].checks.pending, 1);
	assert.equal(byId['wt-main'].checks.passed, 1);
	assert.equal(byId['wt-main'].pullRequest, undefined);
	// A branch without an upstream is asked about under its own name.
	assert.equal(
		Object.values(h.github.calls[0].body.variables).includes(
			'refs/heads/local',
		),
		true,
	);
});

test('a merged pull request is published as merged, even with its branch deleted', async () => {
	const merged = (number, headRefName) => ({
		number,
		title: `PR ${number}`,
		url: `https://github.com/owner/repo/pull/${number}`,
		headRefName,
		headRepository: { nameWithOwner: 'owner/repo' },
	});
	// `local` has no ref on GitHub; `feat/about` has an open pull request.
	const h = harness({
		github: fakeGitHub({
			merged: [merged(51, 'local'), merged(40, 'feat/about')],
		}),
	});
	await flush();
	assert.equal(h.github.calls.length, 1);
	const states = Object.fromEntries(
		h.published.map(({ worktreeId, properties }) => [
			worktreeId,
			properties?.pullRequest &&
				`${properties.pullRequest.number} ${properties.pullRequest.state}`,
		]),
	);
	assert.deepEqual(states, {
		'wt-main': undefined,
		'wt-about': '42 open',
		'wt-local': '51 merged',
	});
	const local = h.published.find((entry) => entry.worktreeId === 'wt-local');
	assert.equal(local.properties.checks, undefined);
});

test('unchanged properties are not published again', async () => {
	const h = harness();
	await flush();
	const count = h.published.length;
	await h.clock.advance(INACTIVE_REFRESH_INTERVAL_MS);
	assert.equal(h.github.calls.length, 2);
	assert.equal(h.published.length, count);
});

test('an inactive project refreshes every 45 s and an active one every 10 s', async () => {
	const h = harness();
	await flush();
	assert.deepEqual(h.clock.pending(), [INACTIVE_REFRESH_INTERVAL_MS]);
	await h.clock.advance(ACTIVE_REFRESH_INTERVAL_MS);
	assert.equal(h.github.calls.length, 1);
	h.setContexts([context({ active: true })]);
	await flush();
	assert.equal(h.github.calls.length, 2, 'becoming active refreshes at once');
	assert.deepEqual(h.clock.pending(), [ACTIVE_REFRESH_INTERVAL_MS]);
	h.setContexts([context({ active: false })]);
	await flush();
	assert.equal(
		h.github.calls.length,
		2,
		'becoming inactive only slows the next refresh',
	);
});

test('a context change refreshes at once', async () => {
	const h = harness();
	await flush();
	h.setContexts([context({ worktrees: context().worktrees.slice(0, 1) })]);
	await flush();
	assert.equal(h.github.calls.length, 2);
});

test('a cancelled context schedules nothing more', async () => {
	const h = harness();
	await flush();
	h.setContexts([]);
	await h.clock.advance(10 * INACTIVE_REFRESH_INTERVAL_MS);
	assert.equal(h.github.calls.length, 1);
	assert.deepEqual(h.clock.pending(), []);
});

test('an aborted session makes no requests', async () => {
	const h = harness();
	await flush();
	h.controller.abort();
	await h.clock.advance(10 * INACTIVE_REFRESH_INTERVAL_MS);
	assert.equal(h.github.calls.length, 1);
});

test('failures widen the interval and one success resets it', async () => {
	let failing = true;
	const github = fakeGitHub({
		answer: () => (failing ? response(502, {}) : undefined),
	});
	const h = harness({ github });
	await flush();
	assert.deepEqual(h.clock.pending(), [FAILURE_BACKOFF_MS[0]]);
	await h.clock.advance(FAILURE_BACKOFF_MS[0]);
	assert.deepEqual(h.clock.pending(), [FAILURE_BACKOFF_MS[1]]);
	failing = false;
	await h.clock.advance(FAILURE_BACKOFF_MS[1]);
	assert.deepEqual(h.clock.pending(), [INACTIVE_REFRESH_INTERVAL_MS]);
});

test('a spent rate limit stops requests to the origin until it resets', async () => {
	const h0 = fakeClock();
	const resetSeconds = Math.floor(h0.now() / 1000) + 600;
	let limited = true;
	const github = fakeGitHub({
		answer: () =>
			limited
				? response(
						403,
						{ message: 'API rate limit exceeded' },
						{
							'x-ratelimit-remaining': '0',
							'x-ratelimit-reset': String(resetSeconds),
						},
					)
				: undefined,
	});
	const h = harness({ github });
	await flush();
	assert.equal(github.calls.length, 1);
	const [wait] = h.clock.pending();
	assert.equal(wait, resetSeconds * 1000 - h.clock.now());
	h.setContexts([context({ active: true })]);
	await flush();
	assert.equal(github.calls.length, 1, 'focus does not bypass the reset');
	limited = false;
	await h.clock.advance(wait);
	assert.equal(github.calls.length, 2);
});

test('retry-after and GraphQL RATE_LIMITED errors also wait', async () => {
	const github = fakeGitHub({
		answer: (count) =>
			count === 1
				? response(429, {}, { 'retry-after': '120' })
				: count === 2
					? response(200, {
							errors: [{ type: 'RATE_LIMITED', message: 'limited' }],
						})
					: undefined,
	});
	const h = harness({ github });
	await flush();
	assert.deepEqual(h.clock.pending(), [120_000]);
	await h.clock.advance(120_000);
	assert.equal(github.calls.length, 2);
	assert.deepEqual(h.clock.pending(), [60_000]);
});

test('a server without per-state totals is asked again without them', async () => {
	const github = fakeGitHub({
		answer: (_count, body) =>
			/CountsByState/.test(body.query)
				? response(200, {
						errors: [{ extensions: { code: 'undefinedField' } }],
					})
				: undefined,
	});
	const h = harness({ github });
	await flush();
	assert.equal(github.calls.length, 2);
	assert.equal(h.published.length, 2);
	await h.clock.advance(INACTIVE_REFRESH_INTERVAL_MS);
	assert.equal(github.calls.length, 3, 'the leaner query is remembered');
});

test('a non-GitHub repository publishes and requests nothing', async () => {
	const h = harness({ isGitHub: false });
	await flush();
	assert.equal(h.github.calls.length, 0);
	assert.deepEqual(h.signIns, []);
	assert.deepEqual(h.clock.pending(), []);
});

test('no credential requests GitHub sign-in once and waits', async () => {
	const h = harness({ cliToken: null });
	await flush();
	assert.equal(h.github.calls.length, 0);
	assert.deepEqual(h.signIns, [
		{
			origin: ORIGIN,
			provider: 'GitHub',
			tokenPageUrl: 'https://github.com/settings/personal-access-tokens/new',
		},
	]);
	assert.deepEqual(h.clock.pending(), []);
	h.github.calls.length = 0;
});

test('a stored token arriving refreshes at once', async () => {
	const github = fakeGitHub({ tokens: ['stored'] });
	const h = harness({ github, cliToken: null });
	await flush();
	h.storeToken('stored');
	await flush();
	assert.equal(github.calls.length, 1);
	assert.equal(github.calls[0].authorization, 'bearer stored');
});

test('a rejected gh token falls back to the stored token', async () => {
	const github = fakeGitHub({ tokens: ['stored'] });
	const h = harness({ github, storedToken: 'stored' });
	await flush();
	assert.deepEqual(h.cliRejected, [ORIGIN]);
	assert.equal(github.calls.at(-1).authorization, 'bearer stored');
	assert.deepEqual(h.signIns, []);
});

test('a revoked stored token is reported rejected and sign-in is requested', async () => {
	const github = fakeGitHub({ tokens: [] });
	const h = harness({ github, cliToken: null, storedToken: 'stored' });
	await flush();
	assert.deepEqual(h.rejected, [ORIGIN]);
	assert.equal(h.signIns.length, 1);
});

test('an Enterprise origin uses its own GraphQL endpoint', async () => {
	const github = fakeGitHub();
	harness({
		github,
		contexts: [
			context({
				remotes: [
					{ name: 'origin', url: 'git@ghe.example.com:owner/repo.git' },
				],
			}),
		],
	});
	await flush();
	assert.equal(github.calls[0].url, 'https://ghe.example.com/api/graphql');
});
