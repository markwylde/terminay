import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { validateExtensionManifest, validateForgePage } from '@terminay/extension-api';
import { createCliTokenStore, createGitHubForgeSource, RateLimitedError, searchString } from '../dist/index.js';

const GH = 'https://github.com';
const signal = new AbortController().signal;
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).terminay;
const viewer = { login: 'me', owners: ['me', 'acme'] };

function cli({ hosts = '', env = {}, gh = async () => undefined } = {}) {
	const runs = [];
	const store = createCliTokenStore({
		env,
		path: '/hosts.yml',
		readFile: async () => hosts,
		ghToken: async (host) => {
			runs.push(host);
			return gh(host);
		},
	});
	return { store, runs };
}

const credentials = (stored = {}) => ({
	token: async (origin) => stored[origin],
	reject: async () => {},
	onAvailable: () => ({ dispose() {} }),
});

function graphqlFetch(answer) {
	const calls = [];
	const fetch = async (url, init) => {
		const body = JSON.parse(init.body);
		calls.push({ url, body, authorization: init.headers.authorization });
		const value = await answer(body, calls.length);
		const status = value?.status ?? 200;
		const headers = value?.headers ?? {};
		return {
			status,
			ok: status < 400,
			headers: { get: (name) => headers[name] ?? null },
			json: async () => value?.json ?? { data: value },
		};
	};
	return { fetch, calls };
}

const viewerAnswer = { viewer: { login: 'me', organizations: { nodes: [{ login: 'acme' }] } } };

function pull(number, extra = {}) {
	return {
		__typename: 'PullRequest',
		number,
		title: `PR ${number}`,
		url: `${GH}/acme/app/pull/${number}`,
		state: 'OPEN',
		createdAt: '2026-11-01T00:00:00Z',
		updatedAt: '2026-11-10T00:00:00Z',
		author: { login: 'octo' },
		labels: { nodes: [{ name: 'bug', color: 'D73A4A' }] },
		comments: { totalCount: 2 },
		repository: { name: 'app', owner: { login: 'acme' } },
		isDraft: false,
		merged: false,
		headRefName: 'feat',
		baseRefName: 'main',
		headRefOid: 'abc1234def',
		headRepository: { name: 'app', owner: { login: 'acme' } },
		commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { totalCount: 1, nodes: [{ __typename: 'CheckRun', name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://ci.example.com/1' }] } } } }] },
		...extra,
	};
}

test('the manifest declares the forge source with owners reach and its permission', () => {
	assert.equal(validateExtensionManifest(manifest).ok, true);
	assert.ok(manifest.permissions.includes('forge-source'));
	assert.deepEqual(manifest.contributes.forgeSources.map((source) => [source.id, source.allReach]), [['com.terminay.github/forge', 'owners']]);
});

test('the search string per scope uses fixed qualifiers', () => {
	const pr = (scope, extra = {}) => searchString({ kind: 'pullRequest', scope, state: 'open', ...extra }, viewer);
	assert.equal(pr('reviewRequested'), 'is:pr archived:false is:open review-requested:@me sort:updated-desc');
	assert.equal(pr('authored', { state: 'merged' }), 'is:pr archived:false is:merged author:@me sort:updated-desc');
	assert.equal(pr('involved', { state: 'closed' }), 'is:pr archived:false is:closed is:unmerged involves:@me sort:updated-desc');
	assert.equal(pr('all'), 'is:pr archived:false is:open user:me user:acme sort:updated-desc');
	assert.equal(pr('all', { owners: ['acme', 'stranger'] }), 'is:pr archived:false is:open user:acme sort:updated-desc');
	assert.equal(pr('all', { owners: ['stranger'] }), undefined, 'All outside the account reach asks nothing');
	const issue = (scope) => searchString({ kind: 'issue', scope, state: 'all' }, viewer);
	assert.equal(issue('assigned'), 'is:issue archived:false assignee:@me sort:updated-desc');
	assert.equal(issue('mentioned'), 'is:issue archived:false mentions:@me sort:updated-desc');
	assert.equal(
		searchString({ kind: 'issue', scope: 'authored', state: 'open', repositories: [{ owner: 'acme', name: 'app' }] }, viewer),
		'is:issue archived:false is:open author:@me repo:acme/app sort:updated-desc',
	);
});

test('text that looks like a qualifier stays one quoted phrase', () => {
	const q = searchString({ kind: 'issue', scope: 'assigned', state: 'open', text: 'repo:evil/x "is:closed" \\ crash' }, viewer);
	assert.equal(q, 'is:issue archived:false is:open assignee:@me "repo:evil/x is:closed crash" sort:updated-desc');
	assert.equal(q.match(/repo:/gu).length, 1);
});

test('keychain-only hosts run gh at most once across accounts and queries', async () => {
	const { store, runs } = cli({ hosts: 'github.com:\n    user: me\n    git_protocol: ssh\n', gh: async () => 'keychain-token' });
	const { fetch, calls } = graphqlFetch((body) =>
		body.query.includes('viewer') ? viewerAnswer : { search: { issueCount: 1, pageInfo: { hasNextPage: false }, nodes: [pull(1)] } },
	);
	const source = createGitHubForgeSource({ fetch, probe: { isGitHub: async () => true }, cli: store, credentials: credentials() });
	const accounts = await source.accounts(signal);
	assert.deepEqual(accounts.map((account) => [account.origin, account.login, account.credentialSource, account.owners]), [[GH, 'me', 'cli', ['me', 'acme']]]);
	await source.query({ kind: 'pullRequest', scope: 'all', state: 'open', origin: GH, pageSize: 50 }, signal);
	await source.accounts(signal);
	assert.equal(runs.length, 1);
	assert.ok(calls.every((call) => call.url === 'https://api.github.com/graphql' && call.authorization === 'bearer keychain-token'));
});

test('a page maps to valid summaries with checks, a cursor, and a total', async () => {
	const { store } = cli({ env: { GH_TOKEN: 'env' } });
	const { fetch, calls } = graphqlFetch((body) =>
		body.query.includes('viewer')
			? viewerAnswer
			: { search: { issueCount: 7, pageInfo: { hasNextPage: true, endCursor: 'Y3Vyc29y' }, nodes: [pull(1), pull(2, { isDraft: true }), { __typename: 'Issue' }] } },
	);
	const source = createGitHubForgeSource({ fetch, probe: { isGitHub: async () => true }, cli: store, credentials: credentials() });
	const query = { kind: 'pullRequest', scope: 'reviewRequested', state: 'open', origin: GH, pageSize: 2 };
	const page = await source.query(query, signal);
	const checked = validateForgePage(page, query);
	assert.equal(checked.ok, true);
	assert.equal(checked.value.dropped, 0);
	assert.deepEqual(page.items.map((item) => [item.reference.number, item.state]), [[1, 'open'], [2, 'draft']]);
	assert.equal(page.items[0].pullRequest.checks.passed, 1);
	assert.equal(page.items[0].labels[0].color, 'd73a4a');
	assert.equal(page.nextCursor, 'Y3Vyc29y');
	assert.equal(page.totalCount, 7);
	const search = calls.find((call) => call.body.query.includes('search('));
	assert.equal(search.body.variables.first, 2);
	assert.equal((await source.accounts(signal))[0].credentialSource, 'environment');
});

test('a spent rate limit backs off until it resets', async () => {
	let now = 1_000_000;
	const { store } = cli({ env: { GH_TOKEN: 'env' } });
	const { fetch, calls } = graphqlFetch((body) =>
		body.query.includes('viewer') ? viewerAnswer : { status: 403, headers: { 'x-ratelimit-remaining': '0', 'retry-after': '30' } },
	);
	const source = createGitHubForgeSource({ fetch, probe: { isGitHub: async () => true }, cli: store, credentials: credentials(), now: () => now });
	const query = { kind: 'issue', scope: 'assigned', state: 'open', origin: GH, pageSize: 10 };
	await assert.rejects(source.query(query, signal), RateLimitedError);
	const before = calls.length;
	await assert.rejects(source.query(query, signal), RateLimitedError);
	assert.equal(calls.length, before, 'no request while the limit is spent');
	now += 31_000;
	await assert.rejects(source.query(query, signal), RateLimitedError);
	assert.equal(calls.length, before + 1);
});

test('detail reads the body and recent comments', async () => {
	const { store } = cli({ env: { GH_TOKEN: 'env' } });
	const { fetch } = graphqlFetch(() => ({
		repository: {
			issueOrPullRequest: {
				...pull(9),
				__typename: 'Issue',
				url: `${GH}/acme/app/issues/9`,
				body: 'Body',
				comments: { totalCount: 1, nodes: [{ author: { login: 'c' }, createdAt: '2026-11-02T00:00:00Z', body: 'hi' }] },
			},
		},
	}));
	const source = createGitHubForgeSource({ fetch, probe: { isGitHub: async () => true }, cli: store, credentials: credentials() });
	const detail = await source.detail({ kind: 'issue', origin: GH, owner: 'acme', name: 'app', number: 9 }, signal);
	assert.equal(detail.body, 'Body');
	assert.deepEqual(detail.comments, [{ author: 'c', createdAt: '2026-11-02T00:00:00Z', body: 'hi' }]);
});

test('claim recognises GitHub remotes only', async () => {
	const { store } = cli();
	const source = createGitHubForgeSource({ fetch: async () => { throw new Error('unused'); }, probe: { isGitHub: async (origin) => origin === GH }, cli: store, credentials: credentials() });
	assert.deepEqual(await source.claim({ name: 'origin', url: 'git@github.com:acme/app.git' }, signal), { origin: GH, owner: 'acme', name: 'app' });
	assert.equal(await source.claim({ name: 'other', url: 'git@git.example.net:acme/app.git' }, signal), null);
});
