import assert from 'node:assert/strict';
import test from 'node:test';
import { validateExtensionManifest, validateForgePage } from '@terminay/extension-api';
import { readFile } from 'node:fs/promises';
import { createGiteaForgeSource, createTeaTokenStore, searchStreams } from '../dist/index.js';

const A = 'https://git.example.net';
const B = 'https://git.other.org';
const signal = new AbortController().signal;

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).terminay;

function tea(text) {
	return createTeaTokenStore({ path: '/tea.yml', readFile: async () => text });
}

function credentials(stored = {}) {
	const rejected = [];
	return {
		rejected,
		token: async (origin) => stored[origin],
		reject: async (origin) => {
			rejected.push(origin);
		},
		onAvailable: () => ({ dispose() {} }),
	};
}

function issue(number, updated, extra = {}) {
	return {
		number,
		title: `Item ${number}`,
		html_url: `${A}/acme/app/issues/${number}`,
		state: 'open',
		comments: 0,
		created_at: '2026-11-01T00:00:00Z',
		updated_at: updated,
		user: { login: 'octo' },
		labels: [{ name: 'bug', color: 'd73a4a' }],
		repository: { full_name: 'acme/app', name: 'app', owner: 'acme' },
		...extra,
	};
}

/** Route Gitea API paths to answers, recording each request. */
function fakeFetch(routes) {
	const calls = [];
	const fetch = async (url, init) => {
		calls.push({ url, authorization: init?.headers?.authorization });
		const { pathname, search } = new URL(url);
		const key = `${pathname.replace(/^\/api\/v1/u, '')}${search}`;
		for (const [pattern, answer] of routes) {
			if (typeof pattern === 'string' ? key === pattern : pattern.test(key)) {
				const value = typeof answer === 'function' ? answer(key, url) : answer;
				// `{ status }` or `{ body, total }` describes a response; anything else is its JSON.
				const wrapped = value !== null && typeof value === 'object' && !Array.isArray(value) && ('status' in value || 'total' in value);
				const status = wrapped ? (value.status ?? 200) : 200;
				return {
					status,
					ok: status < 400,
					headers: { get: (name) => (name === 'x-total-count' && wrapped ? (value.total ?? null) : null) },
					json: async () => (wrapped ? value.body : value),
				};
			}
		}
		return { status: 404, ok: false, headers: { get: () => null }, json: async () => ({}) };
	};
	return { fetch, calls };
}

const probe = { isGitea: async (origin) => origin === A || origin === B };

test('the manifest declares the forge source with readable reach and its permission', () => {
	assert.equal(validateExtensionManifest(manifest).ok, true);
	assert.ok(manifest.permissions.includes('forge-source'));
	assert.deepEqual(manifest.contributes.forgeSources.map((source) => [source.id, source.allReach]), [
		['com.terminay.gitea/forge', 'readable'],
	]);
});

test('two tea logins on two origins give two accounts; two on one origin give one', async () => {
	const config = `logins:\n  - name: a\n    url: ${A}\n    token: ta\n    user: me\n  - name: a2\n    url: ${A}/\n    token: ta2\n  - name: b\n    url: ${B}\n    token: tb\n`;
	const { fetch, calls } = fakeFetch([
		['/user', (_key, url) => ({ login: url.startsWith(A) ? 'me' : 'you' })],
		['/user/orgs?limit=50', [{ username: 'acme' }]],
	]);
	const source = createGiteaForgeSource({ fetch, probe, tea: tea(config), credentials: credentials() });
	const accounts = await source.accounts(signal);
	assert.deepEqual(accounts.map((account) => [account.origin, account.login, account.credentialSource, account.owners]), [
		[A, 'me', 'cli-config', ['me', 'acme']],
		[B, 'you', 'cli-config', ['you', 'acme']],
	]);
	assert.ok(calls.filter((call) => call.url.startsWith(A)).every((call) => call.authorization === 'token ta'));
});

test('a 401 marks the account rejected and stops offering that token', async () => {
	const config = `logins:\n  - url: ${A}\n    token: bad\n    user: me\n`;
	const { fetch } = fakeFetch([['/user', { status: 401 }]]);
	const store = tea(config);
	const source = createGiteaForgeSource({ fetch, probe, tea: store, credentials: credentials() });
	const accounts = await source.accounts(signal);
	assert.deepEqual(accounts.map((account) => [account.login, account.state]), [['me', 'rejected']]);
	assert.equal(await store.token(A), undefined);
});

test('a signed-in origin seen through a claim becomes an account', async () => {
	const { fetch } = fakeFetch([['/user', { login: 'me' }], ['/user/orgs?limit=50', []]]);
	const source = createGiteaForgeSource({ fetch, probe, tea: tea(''), credentials: credentials({ [A]: 'stored' }) });
	assert.deepEqual(await source.claim({ name: 'origin', url: 'ssh://git@git.example.net:4222/acme/app.git' }, signal), { origin: A, owner: 'acme', name: 'app' });
	assert.equal(await source.claim({ name: 'gh', url: 'git@github.com:acme/app.git' }, signal), null);
	const accounts = await source.accounts(signal);
	assert.deepEqual(accounts.map((account) => [account.origin, account.credentialSource]), [[A, 'sign-in']]);
});

test('each scope and state maps to the right search request', () => {
	const shape = (query) => searchStreams({ kind: 'pullRequest', state: 'open', ...query }).map((params) => params.toString());
	assert.deepEqual(shape({ scope: 'reviewRequested' }), ['type=pulls&state=open&review_requested=true']);
	assert.deepEqual(shape({ scope: 'authored', state: 'merged' }), ['type=pulls&state=closed&created=true']);
	assert.deepEqual(shape({ scope: 'all', owners: ['acme'] }), ['type=pulls&state=open&owner=acme']);
	assert.deepEqual(shape({ scope: 'involved' }).length, 4);
	assert.deepEqual(searchStreams({ kind: 'issue', scope: 'mentioned', state: 'all' }).map(String), ['type=issues&state=all&mentioned=true']);
	assert.deepEqual(searchStreams({ kind: 'issue', scope: 'assigned', state: 'closed', repositories: [{ owner: 'acme', name: 'app' }], text: 'crash' }).map(String), [
		'type=issues&state=closed&owner=acme&q=crash&assigned=true',
	]);
});

test('Involved merges four requests, and its second page repeats nothing', async () => {
	// Created: 1, 3; assigned: 1, 2; mentioned: 4; review requested: none.
	const pages = {
		created: [issue(1, '2026-11-10T05:00:00Z'), issue(3, '2026-11-10T03:00:00Z')],
		assigned: [issue(1, '2026-11-10T05:00:00Z'), issue(2, '2026-11-10T04:00:00Z')],
		mentioned: [issue(4, '2026-11-10T02:00:00Z')],
		review_requested: [],
	};
	const { fetch } = fakeFetch([
		[/^\/repos\/issues\/search\?/u, (key) => {
			const params = new URLSearchParams(key.split('?')[1]);
			const flag = ['created', 'assigned', 'mentioned', 'review_requested'].find((name) => params.get(name) === 'true');
			const limit = Number(params.get('limit'));
			const page = Number(params.get('page'));
			return pages[flag].slice((page - 1) * limit, page * limit);
		}],
		[/^\/repos\/acme\/app\/issues\/\d+\/comments/u, []],
	]);
	const source = createGiteaForgeSource({ fetch, probe, tea: tea(`logins:\n  - url: ${A}\n    token: t\n`), credentials: credentials() });
	const query = { kind: 'issue', scope: 'involved', state: 'open', origin: A, pageSize: 2 };
	const seen = [];
	let cursor;
	for (let round = 0; round < 5; round += 1) {
		const page = await source.query({ ...query, ...(cursor === undefined ? {} : { cursor }) }, signal);
		assert.equal(validateForgePage(page, query).value.dropped, 0);
		seen.push(...page.items.map((item) => item.reference.number));
		cursor = page.nextCursor;
		if (cursor === undefined) break;
	}
	assert.deepEqual(seen, [1, 2, 3, 4]);
});

test('merged narrows closed pull requests and may give a short page that continues', async () => {
	const merged = issue(7, '2026-11-10T02:00:00Z', { state: 'closed', pull_request: { merged: true }, html_url: `${A}/acme/app/pulls/7` });
	const closed = issue(8, '2026-11-10T03:00:00Z', { state: 'closed', pull_request: { merged: false }, html_url: `${A}/acme/app/pulls/8` });
	const { fetch } = fakeFetch([
		[/^\/repos\/issues\/search\?.*page=1/u, [closed, merged]],
		[/^\/repos\/issues\/search\?.*page=2/u, []],
		[/^\/repos\/acme\/app\/pulls\/\d+$/u, (key) => ({ number: Number(key.split('/').at(-1)), head: { ref: 'feat', sha: 'abc1234def', repo: { name: 'app', owner: { login: 'acme' } } }, base: { ref: 'main' } })],
	]);
	const source = createGiteaForgeSource({ fetch, probe, tea: tea(`logins:\n  - url: ${A}\n    token: t\n`), credentials: credentials() });
	const page = await source.query({ kind: 'pullRequest', scope: 'authored', state: 'merged', origin: A, pageSize: 2 }, signal);
	assert.deepEqual(page.items.map((item) => [item.reference.number, item.state]), [[7, 'merged']]);
	assert.equal(page.items[0].pullRequest.headBranch, 'feat');
	assert.ok(page.nextCursor, 'a full upstream page continues even when the merged filter left one');
	assert.equal(page.totalCount, undefined, 'a filtered page has no honest total');
});

test('an open pull request carries its head, base, and combined status', async () => {
	const pull = issue(5, '2026-11-10T00:00:00Z', { pull_request: { merged: false }, html_url: `${A}/acme/app/pulls/5` });
	const { fetch } = fakeFetch([
		[/^\/repos\/issues\/search\?/u, () => ({ body: [pull], total: '1' })],
		['/repos/acme/app/pulls/5', { number: 5, head: { ref: 'change/13', sha: 'deadbeef', repo: { name: 'app', owner: { login: 'forker' } } }, base: { ref: 'main' } }],
		['/repos/acme/app/commits/deadbeef/status?limit=100', { statuses: [{ context: 'ci', status: 'success', target_url: '/acme/app/actions/runs/1' }] }],
	]);
	const source = createGiteaForgeSource({ fetch, probe, tea: tea(`logins:\n  - url: ${A}\n    token: t\n`), credentials: credentials() });
	const query = { kind: 'pullRequest', scope: 'all', state: 'open', origin: A, pageSize: 50 };
	const page = await source.query(query, signal);
	assert.equal(validateForgePage(page, query).value.dropped, 0);
	assert.equal(page.totalCount, 1);
	const facts = page.items[0].pullRequest;
	assert.deepEqual([facts.headBranch, facts.baseBranch, facts.headOwner, facts.checks.passed], ['change/13', 'main', 'forker', 1]);
	assert.equal(facts.checks.items[0].url, `${A}/acme/app/actions/runs/1`);
});

test('detail reads the body and the ten most recent comments, oldest first', async () => {
	const comments = Array.from({ length: 10 }, (_, index) => ({ user: { login: 'c' }, created_at: `2026-11-0${(index % 9) + 1}T00:00:00Z`, body: `comment ${index + 11}` }));
	const { fetch, calls } = fakeFetch([
		['/repos/acme/app/issues/3', issue(3, '2026-11-10T00:00:00Z', { body: 'The body', comments: 20 })],
		['/repos/acme/app/issues/3/comments?limit=10&page=2', comments],
	]);
	const source = createGiteaForgeSource({ fetch, probe, tea: tea(`logins:\n  - url: ${A}\n    token: t\n`), credentials: credentials() });
	const detail = await source.detail({ kind: 'issue', origin: A, owner: 'acme', name: 'app', number: 3 }, signal);
	assert.equal(detail.body, 'The body');
	assert.equal(detail.comments.length, 10);
	assert.equal(detail.comments[0].body, 'comment 11');
	assert.ok(calls.every((call) => call.url.startsWith(`${A}/api/v1/`)));
});
