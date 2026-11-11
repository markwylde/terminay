// Pull Requests and Issues views (ADR-0105), drawn to markup.
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const testDirectory = await mkdtemp(join(process.cwd(), '.forge-ui-test-'));
process.on('exit', () => rmSync(testDirectory, { recursive: true, force: true }));

async function bundle(entryPoint, outputName) {
	const outputPath = join(testDirectory, outputName);
	await build({
		entryPoints: [entryPoint],
		outfile: outputPath,
		bundle: true,
		format: 'cjs',
		platform: 'node',
		external: ['react', 'react-dom'],
		loader: { '.css': 'empty' },
		alias: {
			'@terminay/client-core': './packages/client-core/src/index.ts',
			'@terminay/protocol': './packages/protocol/src/index.ts',
		},
		logLevel: 'silent',
	});
	return require(outputPath);
}

const views = await bundle('src/forge/ForgeViews.tsx', 'views.cjs');
const settingsModule = await bundle('src/forge/ForgeSettings.tsx', 'settings.cjs');
const homeModule = await bundle('src/forge/ForgeHome.tsx', 'forge-home.cjs');
const { HomeView } = await bundle('src/workspace/HomeView.tsx', 'home-view.cjs');
const { FoldersColumn } = await bundle('src/components/folders/FoldersColumn.tsx', 'folders-column.cjs');

const h = React.createElement;
const html = (element) => renderToStaticMarkup(element);
const ORIGIN = 'https://git.example.net';
const NOW = Date.parse('2026-11-11T12:00:00Z');

function entry(number, extra = {}, repo = 'app', worktrees = []) {
	return {
		sourceId: 'com.terminay.gitea/forge',
		item: {
			reference: { kind: 'pullRequest', origin: ORIGIN, owner: 'acme', name: repo, number },
			title: `Pull request ${number}`,
			url: `${ORIGIN}/acme/${repo}/pulls/${number}`,
			state: 'open',
			author: 'octo',
			labels: [],
			comments: 0,
			createdAt: '2026-11-10T00:00:00Z',
			updatedAt: `2026-11-1${number % 10}T00:00:00Z`.slice(0, 20),
			pullRequest: { headBranch: `change/${number}`, baseBranch: 'main', headOwner: 'acme', headName: repo },
			...extra,
		},
		worktrees,
	};
}

const issue = (number, title = `Issue ${number}`) => ({
	...entry(number),
	item: {
		...entry(number).item,
		reference: { kind: 'issue', origin: ORIGIN, owner: 'acme', name: 'app', number },
		title,
		url: `${ORIGIN}/acme/app/issues/${number}`,
		pullRequest: undefined,
	},
});

const actions = {
	openWorktree() {},
	planWorktree: async () => ({ path: null, branchValid: true, branchExists: false, checkedOutAt: null }),
	openInWorktree: async () => ({ ok: true }),
	openExternal() {},
	openSettings() {},
};

function environment(overrides = {}) {
	return {
		projects: [
			{ projectId: 'forum', title: 'Forum' },
			{ projectId: 'review', title: 'Forum Review' },
		],
		claims: new Map([
			['forum', [{ sourceId: 'com.terminay.gitea/forge', origin: ORIGIN, owner: 'acme', name: 'app', kinds: ['pullRequest', 'issue'], projectTabs: true }]],
		]),
		launchers: [
			{ id: 'claude', label: 'Claude Code' },
			{ id: 'codex', label: 'Codex' },
		],
		canWrite: true,
		displayNames: new Map([['com.terminay.gitea/forge', 'Gitea']]),
		actions,
		...overrides,
	};
}

const listProps = (overrides = {}) => ({
	kind: 'pullRequest',
	preferences: { scope: 'reviewRequested', state: 'open', group: 'repo' },
	onPreferencesChange() {},
	items: [],
	sources: [],
	noAccounts: false,
	loading: false,
	settled: true,
	now: NOW,
	onSelect() {},
	onRefresh() {},
	onLoadMore() {},
	onOpenSettings() {},
	projectTitle: (id) => ({ forum: 'Forum', review: 'Forum Review' })[id],
	projectOrder: ['forum', 'review'],
	displayNames: new Map([['com.terminay.gitea/forge', 'Gitea']]),
	...overrides,
});

// ── Home sidebar (6.1) ──────────────────────────────────────────────────

const homeView = (props = {}) =>
	html(
		h(HomeView, {
			currentSection: 'home',
			isActive: true,
			isSidebarVisible: true,
			onDismissSidebar() {},
			onOpenSection() {},
			onSidebarWidthCommit() {},
			sidebarWidth: 220,
			...props,
		}, h('div')),
	);

test('Home lists Pull Requests and Issues after Recordings, with neutral counts', () => {
	const markup = homeView({
		sectionBadges: {
			pullRequests: { count: 2, label: '2 pull requests need your review', tone: 'neutral' },
			issues: { count: 4, label: '4 issues assigned to you', tone: 'neutral' },
			workflows: { count: 1, label: '1 workflow needs you' },
		},
	});
	const order = [...markup.matchAll(/data-terminay-home-section-tab="([a-zA-Z]+)"/gu)].map((match) => match[1]);
	assert.deepEqual(order, ['home', 'tabs', 'bots', 'automations', 'workflows', 'recordings', 'pullRequests', 'issues']);
	assert.match(markup, /class="home-sidebar__badge home-sidebar__badge--neutral"[^>]*data-terminay-home-section-badge="pullRequests">2</u);
	assert.match(markup, /data-terminay-home-section-badge="issues">4</u);
	assert.match(markup, /class="home-sidebar__badge"[^>]*data-terminay-home-section-badge="workflows"/u);
	assert.match(markup, /aria-label="Pull Requests, 2 pull requests need your review"/u);
});

test('Home hides the sections it does not offer', () => {
	const markup = homeView({ hiddenSections: new Set(['pullRequests', 'issues']) });
	assert.doesNotMatch(markup, /data-terminay-home-section-tab="pullRequests"/u);
	assert.doesNotMatch(markup, /data-terminay-home-section-tab="issues"/u);
	const issuesOnly = homeView({ hiddenSections: new Set(['pullRequests']) });
	assert.match(issuesOnly, /data-terminay-home-section-tab="issues"/u);
	assert.doesNotMatch(issuesOnly, /data-terminay-home-section-tab="pullRequests"/u);
});

// ── The list (6.2, 6.8) ─────────────────────────────────────────────────

test('the list groups by repository, marks the selected row, and chips worktrees with +N', () => {
	const markup = html(
		h(views.ForgeListPane, listProps({
			items: [
				entry(1, {}, 'app', [
					{ projectId: 'review', worktreeId: 'w2', branch: 'change/1' },
					{ projectId: 'forum', worktreeId: 'w1', branch: 'change/1' },
				]),
				entry(3, {}, 'site'),
				entry(2),
			],
			selectedKey: 'pullRequest\u0000https://git.example.net\u0000acme/app#2',
		})),
	);
	const groups = [...markup.matchAll(/data-forge-group="([^"]+)"/gu)].map((match) => match[1]);
	assert.deepEqual(groups, ['acme/site', 'acme/app']);
	assert.match(markup, /aria-current="true" data-forge-row="2"/u);
	assert.match(markup, /data-forge-worktree-chip="true">.*Forum \+1</u);
	assert.match(markup, /aria-pressed="true"[^>]*data-forge-scope="reviewRequested"/u);
});

test('All carries the owners reach note; other scopes do not', () => {
	const note = 'GitHub: All covers repositories owned by your account and its organisations.';
	const all = html(h(views.ForgeListPane, listProps({ preferences: { scope: 'all', state: 'open', group: 'repo' }, ownersReachNote: note })));
	assert.match(all, /data-forge-owners-note="true">GitHub: All covers/u);
	const mine = html(h(views.ForgeListPane, listProps({ preferences: { scope: 'authored', state: 'open', group: 'repo' }, ownersReachNote: note })));
	assert.doesNotMatch(mine, /data-forge-owners-note/u);
});

test('empty lists say why: no accounts, no matches, or a failed source', () => {
	const noAccounts = html(h(views.ForgeListPane, listProps({ noAccounts: true })));
	assert.match(noAccounts, /data-forge-empty="noAccounts"/u);
	assert.match(noAccounts, /No forge account is set up/u);
	assert.match(noAccounts, /Open Settings › Extensions/u);
	const none = html(h(views.ForgeListPane, listProps()));
	assert.match(none, /data-forge-empty="noMatches"/u);
	const failed = html(h(views.ForgeListPane, listProps({ sources: [{ sourceId: 'com.terminay.gitea/forge', origin: ORIGIN, state: 'failed', error: 'timeout' }] })));
	assert.match(failed, /data-forge-empty="failed"/u);
	assert.match(failed, /Gitea \(https:\/\/git\.example\.net\) could not be reached: timeout/u);
	assert.match(failed, />Retry</u);
});

test('a partial failure still shows the items from the others', () => {
	const markup = html(
		h(views.ForgeListPane, listProps({
			items: [entry(1)],
			sources: [
				{ sourceId: 'com.terminay.gitea/forge', origin: ORIGIN, state: 'ok' },
				{ sourceId: 'com.terminay.github/forge', origin: 'https://github.com', state: 'failed', error: 'rate limited' },
			],
		})),
	);
	assert.match(markup, /data-forge-failure="true"/u);
	assert.match(markup, /data-forge-row="1"/u);
	assert.doesNotMatch(markup, /data-forge-empty/u);
});

// ── The detail pane (6.2, 6.3) ──────────────────────────────────────────

test('the detail shows the body as text and failed checks first', () => {
	const checks = {
		passed: 1, failed: 2, pending: 0, skipped: 0, total: 3,
		items: [
			{ name: 'unit', state: 'passed' },
			{ name: 'e2e (shard 4/10)', state: 'failed' },
			{ name: 'e2e (shard 7/10)', state: 'failed' },
		],
	};
	const pr = entry(88, { pullRequest: { headBranch: 'change/13-events', baseBranch: 'main', headOwner: 'acme', headName: 'app', checks } });
	const markup = html(
		h(views.ForgeDetailPane, {
			entry: pr,
			body: '<script>alert(1)</script> See https://example.com/x.',
			comments: [],
			loading: false,
			environment: environment(),
			now: NOW,
		}),
	);
	assert.doesNotMatch(markup, /<script>/u);
	assert.match(markup, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
	assert.match(markup, /<a href="https:\/\/example.com\/x">https:\/\/example.com\/x<\/a>/u);
	const order = [...markup.matchAll(/data-forge-check="([a-z]+)"/gu)].map((match) => match[1]);
	assert.deepEqual(order, ['failed', 'failed', 'passed']);
	assert.match(markup, /change\/13-events → main/u);
	assert.match(markup, /data-forge-action="Check out in new worktree"/u);
	assert.match(markup, /Open on Gitea/u);
});

test('actions from a fork are disabled and say why', () => {
	const fork = entry(9, { pullRequest: { headBranch: 'main', baseBranch: 'main', headOwner: 'forker', headName: 'app' } });
	const markup = html(h(views.ForgeDetailPane, { entry: fork, loading: false, environment: environment(), now: NOW }));
	assert.match(markup, /disabled=""[^>]*data-forge-action="Check out in new worktree"/u);
	assert.match(markup, /data-forge-reason="Check out in new worktree">Pull requests from forks cannot be checked out\./u);
	assert.match(markup, /data-forge-reason="Review with agent">Pull requests from forks cannot be checked out\./u);
});

test('a repository not open as a project disables checkout and Start work', () => {
	const env = environment({ claims: new Map() });
	const pull = html(h(views.ForgeDetailPane, { entry: entry(1), loading: false, environment: env, now: NOW }));
	assert.match(pull, /Open this repository as a project to check out its pull requests\./u);
	const iss = html(h(views.ForgeDetailPane, { entry: issue(5), loading: false, environment: env, now: NOW }));
	assert.match(iss, /data-forge-reason="Start work">Open this repository as a project to start work on its issues\./u);
});

test('a matched worktree offers Open worktree, and a choice when there are two', () => {
	const matched = entry(1, {}, 'app', [
		{ projectId: 'forum', worktreeId: 'w1', branch: 'change/1', path: '/a' },
		{ projectId: 'review', worktreeId: 'w2', branch: 'change/1', path: '/b' },
	]);
	const markup = html(h(views.ForgeDetailPane, { entry: matched, loading: false, environment: environment(), now: NOW }));
	assert.match(markup, /data-forge-action="Open worktree"/u);
	assert.doesNotMatch(markup, /data-forge-action="Check out in new worktree"/u);
	assert.match(markup, /Forum · change\/1/u);
	assert.match(markup, /Forum Review · change\/1/u);
});

test('Check out offers a project choice when the repository is open twice', () => {
	const claim = [{ sourceId: 'com.terminay.gitea/forge', origin: ORIGIN, owner: 'acme', name: 'app', kinds: ['pullRequest'], projectTabs: true }];
	const env = environment({ claims: new Map([['forum', claim], ['review', claim]]) });
	const markup = html(h(views.ForgeDetailPane, { entry: entry(1), loading: false, environment: env, now: NOW }));
	assert.match(markup, /<option value="forum"[^>]*>Forum<\/option><option value="review"[^>]*>Forum Review<\/option>/u);
});

test('Start work suggests the issue branch, prompt-accepting launchers, and Shell only', () => {
	const item = issue(541, 'Home sidebar: Pull Requests and Issues sections').item;
	const markup = html(
		h(views.StartWorkPanel, {
			item,
			body: 'The sidebar should list them.',
			projects: [{ projectId: 'forum', title: 'Forum' }],
			launchers: [{ id: 'claude', label: 'Claude Code' }],
			actions,
			onDone() {},
			onCancel() {},
		}),
	);
	assert.match(markup, /value="issue-541-home-sidebar-pull-requests-and-issues-sections"/u);
	assert.match(markup, /<option value="claude"[^>]*>Claude Code<\/option><option value="">Shell only<\/option>/u);
	assert.match(markup, /Work on issue #541, &quot;Home sidebar: Pull Requests and Issues sections&quot;/u);
	assert.match(markup, /The issue says: &quot;The sidebar should list them\.&quot;/u);
});

test('Review with agent suggests a prompt naming the pull request', () => {
	const markup = html(h(views.ReviewPanel, { item: entry(88).item, launchers: [{ id: 'codex', label: 'Codex' }], busy: false, onConfirm() {}, onCancel() {} }));
	assert.match(markup, /Review pull request #88, &quot;Pull request 88&quot; \(https:\/\/git.example.net\/acme\/app\/pulls\/88\)/u);
	assert.match(markup, /<option value="codex"[^>]*>Codex<\/option>/u);
});

// ── Project tabs (6.5) ──────────────────────────────────────────────────

const column = (props) =>
	html(
		h(FoldersColumn, {
			folders: [],
			idPrefix: 'col',
			collapsedFolderIds: new Set(),
			onToggleFolderCollapsed() {},
			onSelectTab() {},
			selectedTab: 'tabs',
			onSelectFolder() {},
			onSelectPanel() {},
			...props,
		}),
	);

test('the left column shows Pull Requests and Issues tabs only when claimed, after Agents, with counts', () => {
	const tabs = (markup) => [...markup.matchAll(/id="col-tab-([a-zA-Z]+)"/gu)].map((match) => match[1]);
	assert.deepEqual(tabs(column({})), [], 'one list: no tabs');
	assert.deepEqual(tabs(column({ agents: h('div') })), ['tabs', 'agents']);
	const forge = { pullRequests: { pane: h('div', null, 'prs'), count: 3 }, issues: { pane: h('div'), count: 0 } };
	const withAgents = column({ agents: h('div'), ...forge });
	assert.deepEqual(tabs(withAgents), ['tabs', 'agents', 'pullRequests', 'issues']);
	assert.match(withAgents, /aria-label="Pull Requests, 3"/u);
	assert.match(withAgents, /data-sidebar-tab-badge="pullRequests">3</u);
	assert.doesNotMatch(withAgents, /data-sidebar-tab-badge="issues"/u);
	assert.deepEqual(tabs(column({ ...forge })), ['tabs', 'pullRequests', 'issues']);
	const selected = column({ ...forge, selectedTab: 'pullRequests' });
	assert.match(selected, /data-folders-column-panel="pullRequests" aria-hidden="false"/u);
	const gone = column({ selectedTab: 'pullRequests', agents: h('div') });
	assert.match(gone, /data-folders-column-panel="tabs" aria-hidden="false"/u);
});

test('a project row goes to Home with its repository and item, or opens here when bound', () => {
	const pr = entry(535);
	assert.deepEqual(homeModule.projectRowActivation(pr, false), {
		kind: 'home',
		focus: {
			kind: 'pullRequest',
			repository: { origin: ORIGIN, owner: 'acme', name: 'app' },
			item: pr.item.reference,
			sourceId: 'com.terminay.gitea/forge',
		},
	});
	assert.deepEqual(homeModule.projectRowActivation(pr, true), {
		kind: 'detail',
		sourceId: 'com.terminay.gitea/forge',
		reference: pr.item.reference,
	});
});

function projectTabs(options) {
	let captured;
	function Probe() {
		captured = homeModule.useProjectForgeTabs(options);
		return null;
	}
	html(h(Probe));
	return captured;
}

test('project tabs follow the claims, and Show all on Home is absent when bound', () => {
	const claim = (kinds, projectTabs = true) => ({ sourceId: 'com.terminay.gitea/forge', origin: ORIGIN, owner: 'acme', name: 'app', kinds, projectTabs });
	const base = { client: undefined, projectId: 'forum', visible: true, bound: false, environment: environment(), openInHome() {} };
	const both = projectTabs({ ...base, claims: [claim(['pullRequest', 'issue'])] });
	assert.ok(both.pullRequests !== undefined && both.issues !== undefined);
	const pane = html(h('div', null, both.pullRequests.pane));
	assert.match(pane, /data-forge-show-all="pullRequest">Show all on Home/u);
	assert.match(pane, /Gitea · acme\/app/u);
	const issuesOnly = projectTabs({ ...base, claims: [claim(['issue'])] });
	assert.equal(issuesOnly.pullRequests, undefined);
	assert.equal(projectTabs({ ...base, claims: [claim(['pullRequest'], false)] }).pullRequests, undefined, 'switched off in Settings');
	assert.equal(projectTabs({ ...base, claims: [] }).issues, undefined);
	const bound = projectTabs({ ...base, bound: true, claims: [claim(['pullRequest'])] });
	assert.doesNotMatch(html(h('div', null, bound.pullRequests.pane)), /Show all on Home/u);
});

// ── Settings (6.7) ──────────────────────────────────────────────────────

const settingsData = (overrides = {}) => ({
	sources: [{ sourceId: 'com.terminay.github/forge', extensionId: 'com.terminay.github', displayName: 'GitHub', allReach: 'owners', settings: { repositories: 'owners', owners: ['acme'], pullRequestsOnHome: true, issuesOnHome: false, projectTabs: true } }],
	accounts: [
		{ origin: 'https://github.com', login: 'octo', credentialSource: 'cli-config', state: 'ready', owners: ['octo', 'acme'], removable: false },
		{ origin: 'https://ghe.example.com', login: 'octo', credentialSource: 'sign-in', state: 'rejected', owners: ['octo'], removable: true },
	],
	accountErrors: [],
	owners: ['acme', 'octo'],
	settings: { repositories: 'owners', owners: ['acme'], pullRequestsOnHome: true, issuesOnHome: false, projectTabs: true },
	...overrides,
});

test('Settings lists detected accounts and asks a rejected one to sign in', () => {
	const markup = html(h(settingsModule.ForgeSettingsView, { data: settingsData(), busy: false, onSettingsChange() {}, onAddAccount() {}, onRemoveAccount() {}, onRecheck() {} }));
	assert.match(markup, /data-forge-account="https:\/\/github.com" data-forge-account-state="ready"/u);
	assert.match(markup, /From the CLI login · 1 organisation/u);
	assert.match(markup, /data-forge-account-state="rejected"[\s\S]*?Sign in again[\s\S]*?>Sign in<\/button>[\s\S]*?>Remove</u);
	assert.match(markup, /data-forge-add-account="true"/u);
});

test('Settings shows the owner catalogue, the owners reach label, and the switches', () => {
	const markup = html(h(settingsModule.ForgeSettingsView, { data: settingsData(), busy: false, onSettingsChange() {}, onAddAccount() {}, onRemoveAccount() {}, onRecheck() {} }));
	assert.match(markup, /Everything my accounts and their organisations own/u);
	assert.match(markup, /data-forge-owner-catalogue="true"/u);
	assert.match(markup, /<input type="checkbox" checked=""\/>acme/u);
	assert.match(markup, /<input type="checkbox"\/>octo/u);
	assert.match(markup, /data-forge-switch="issuesOnHome"[\s\S]*?<input type="checkbox"\/>/u);
	const readable = settingsData({ sources: [{ ...settingsData().sources[0], allReach: 'readable' }] });
	assert.match(html(h(settingsModule.ForgeSettingsView, { data: readable, busy: false, onSettingsChange() {}, onAddAccount() {}, onRemoveAccount() {}, onRecheck() {} })), /Everything I can access/u);
});

test('loadForgeSettings reads one extension\'s sources, accounts, and owners', async () => {
	const calls = [];
	const client = {
		sources: async () => ({ sources: [...settingsData().sources, { sourceId: 'other/forge', extensionId: 'other', displayName: 'X', allReach: 'readable', settings: {} }] }),
		accounts: async (fresh) => {
			calls.push(`accounts ${fresh}`);
			return { sources: [{ extensionId: 'com.terminay.github', accounts: settingsData().accounts }, { extensionId: 'other', accounts: [{ origin: 'x' }] }] };
		},
		owners: async () => ({ owners: { 'com.terminay.github': ['acme', 'octo'] } }),
	};
	const data = await settingsModule.loadForgeSettings(client, 'com.terminay.github', true);
	assert.equal(data.accounts.length, 2);
	assert.deepEqual(data.owners, ['acme', 'octo']);
	assert.deepEqual(calls, ['accounts true']);
	assert.equal(await settingsModule.loadForgeSettings(client, 'missing'), undefined);
});
