import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const testDirectory = await mkdtemp(join(process.cwd(), '.compact-ui-test-'));

async function bundleComponent(entryPoint, outputName) {
	const outputPath = join(testDirectory, outputName);
	await build({
		entryPoints: [entryPoint],
		outfile: outputPath,
		bundle: true,
		format: 'cjs',
		platform: 'node',
		external: ['react'],
		loader: { '.css': 'empty' },
		logLevel: 'silent',
	});
	return require(outputPath);
}

const { CompactChromeRow, compactTitleLabel } = await bundleComponent(
	'src/workspace/CompactChromeRow.tsx',
	'compact-chrome-row.cjs',
);
const { CompactSwitcher } = await bundleComponent(
	'src/workspace/CompactSwitcher.tsx',
	'compact-switcher.cjs',
);
const { workflowStepLine } = await bundleComponent(
	'src/workspace/workflows/WorkflowTabBadge.tsx',
	'workflow-tab-badge.cjs',
);

test.after(() => rm(testDirectory, { force: true, recursive: true }));

const noop = () => {};

const terminalTitle = {
	kind: 'project',
	projectTitle: 'Paged',
	color: '#7c5cff',
	folderName: 'worktree-mobile-rail',
	panel: {
		title: 'server',
		panelId: 'panel-a',
		isTerminal: true,
		serverId: 'local',
		sessionId: 's-a',
	},
};

const row = (overrides) =>
	renderToStaticMarkup(
		React.createElement(CompactChromeRow, {
			connection: {
				isExposed: false,
				isReachable: true,
				serverLabel: 'Marks-MacBook-Air',
				tone: 'remote-access-button--idle',
			},
			homeAttention: false,
			isExplorerOpen: false,
			isHomeSelected: false,
			isNotificationsOpen: false,
			isSwitcherOpen: false,
			notificationCount: 0,
			onOpenCommandBar: noop,
			onOpenSwitcher: noop,
			onToggleExplorer: noop,
			onToggleHome: noop,
			onToggleNotifications: noop,
			title: terminalTitle,
			...overrides,
		}),
	);

test('the compact row holds its controls in order, with Home before Notifications', () => {
	const markup = row({
		applicationMenu: React.createElement(
			'button',
			{ type: 'button', className: 'connected-web-compact-menu__button' },
			'Menu',
		),
	});
	const order = [
		'connected-web-compact-menu__button',
		'Toggle file explorer',
		'data-compact-command-bar',
		'data-compact-breadcrumb',
		'data-compact-home-toggle',
		'data-compact-notifications-button',
		'data-compact-connection',
	];
	let cursor = -1;
	for (const marker of order) {
		const next = markup.indexOf(marker);
		assert.ok(next > cursor, `${marker} is out of order`);
		cursor = next;
	}
});

test("with Pixel on, its slot takes the connection glyph's place and the title block carries the server warning", () => {
	const markup = row({
		pixelSlotRef: () => {},
		connection: {
			isExposed: true,
			isReachable: false,
			serverLabel: 'Local',
			tone: '',
		},
	});
	assert.match(markup, /data-compact-pixel-slot="true"/);
	assert.doesNotMatch(markup, /data-compact-connection="true"/);
	assert.match(markup, /data-compact-breadcrumb-alert="true"/);
	assert.match(markup, /Local unreachable/);
});

test('the title block names the terminal over its project and folder, without the worktree prefix', () => {
	const markup = row({});
	assert.match(
		markup,
		/data-compact-breadcrumb-segment="terminal"[^>]*>server</,
	);
	assert.match(markup, /data-compact-breadcrumb-segment="project"[^>]*>Paged</);
	assert.match(markup, /compact-title__folder">mobile-rail</);
	assert.doesNotMatch(markup, />worktree-mobile-rail</);
	// The accessible name keeps the full folder name.
	assert.match(
		markup,
		/aria-label="Switch terminal — server, worktree-mobile-rail in Paged"/,
	);
	assert.match(markup, /aria-haspopup="dialog"/);
});

test('a file panel in front is named by its file and carries no dial', () => {
	const markup = row({
		title: {
			...terminalTitle,
			folderName: 'General',
			panel: { title: 'README.md', panelId: 'file-1', isTerminal: false },
		},
	});
	assert.match(
		markup,
		/data-compact-breadcrumb-segment="terminal"[^>]*>README\.md</,
	);
	assert.doesNotMatch(markup, /workflow-dial/);
	assert.match(
		markup,
		/aria-label="Switch terminal — README\.md, General in Paged"/,
	);
});

test('a project with no panel in front is named by the project', () => {
	const markup = row({
		title: { kind: 'project', projectTitle: 'Paged', folderName: 'General' },
	});
	assert.match(
		markup,
		/data-compact-breadcrumb-segment="terminal"[^>]*>Paged</,
	);
	assert.match(markup, /aria-label="Switch terminal — General in Paged"/);
});

test('on Home the title block names the Home tab over Home', () => {
	const markup = row({
		isHomeSelected: true,
		title: { kind: 'home', tabTitle: 'Workflows' },
	});
	assert.match(
		markup,
		/data-compact-breadcrumb-segment="terminal"[^>]*>Workflows</,
	);
	assert.match(markup, /compact-title__where">Home</);
	assert.equal(
		compactTitleLabel({ kind: 'home', tabTitle: 'Workflows' }),
		'Switch terminal — Workflows, Home',
	);
});

test('the Home toggle shows its state and an attention marker', () => {
	const away = row({ homeAttention: true });
	assert.match(away, /data-compact-home-toggle="true"/);
	assert.match(away, /aria-label="Home, a terminal needs you"/);
	assert.match(away, /compact-home-toggle__dot/);
	const home = row({
		homeAttention: true,
		isHomeSelected: true,
		title: { kind: 'home', tabTitle: 'Home' },
	});
	assert.match(
		home,
		/aria-pressed="true"[^>]*data-compact-home-toggle|data-compact-home-toggle[^>]*aria-pressed="true"|aria-pressed="true"/,
	);
	assert.match(home, /aria-label="Back to project"/);
	// Home itself is where the attention is listed, so the dot is not repeated.
	assert.doesNotMatch(home, /compact-home-toggle__dot/);
});

test('the connection control shows a glyph and keeps its server name for AT', () => {
	const markup = row({});
	assert.doesNotMatch(markup, /compact-connection[^>]*>[^<]*Marks-MacBook-Air/);
	assert.match(markup, /aria-label="Connections — Marks-MacBook-Air, Offline"/);
	assert.match(markup, /remote-access-button--idle/);
	assert.match(markup, /compact-connection__dot/);
});

test('a pending update stays on the compact row', () => {
	const markup = row({
		updateAction: React.createElement(
			'div',
			{ className: 'app-update-status' },
			'Update Now',
		),
	});
	assert.match(markup, /app-update-status/);
	assert.ok(
		markup.indexOf('app-update-status') <
			markup.indexOf('data-compact-notifications-button'),
	);
});

/* ------------------------------------------------------------ the drawer */

const terminalRow = (overrides) => ({
	isAgentStatus: false,
	key: 'local:panel-a',
	panelId: 'panel-a',
	panelKind: 'terminal',
	projectId: 'p1',
	serverId: 'local',
	sessionId: 's-a',
	state: 'idle',
	title: 'server',
	...overrides,
});

const server = terminalRow({
	preview: '✓ built in 2.41s',
	folderId: 'general',
});
const claude = terminalRow({
	isAgentStatus: true,
	key: 'local:panel-b',
	panelId: 'panel-b',
	sessionId: 's-b',
	state: 'working',
	title: 'claude',
	folderId: 'wt',
});

const folder = (folderId, name, panels, extra = {}) => ({
	folderId,
	isGeneral: false,
	isLinked: false,
	key: `local:folder:${folderId}`,
	name,
	panels,
	...extra,
});

const paged = {
	color: '#7c5cff',
	emoji: '',
	folders: [
		folder('general', 'General', [server], { isGeneral: true }),
		folder('wt', 'worktree-mobile-rail', [claude], { isLinked: true }),
		folder('empty', 'scratch', []),
	],
	key: 'local:p1',
	projectId: 'p1',
	serverId: 'local',
	panels: [server, claude],
	summary: { attention: 0, working: 1, done: 0, idle: 1 },
	title: 'Paged',
};

const dotfiles = {
	color: '#4fd08a',
	emoji: '🔧',
	folders: [],
	key: 'local:p2',
	projectId: 'p2',
	serverId: 'local',
	panels: [
		terminalRow({
			key: 'local:panel-c',
			panelId: 'panel-c',
			projectId: 'p2',
			sessionId: 's-c',
			state: 'waiting',
			title: 'codex',
		}),
	],
	summary: { attention: 1, working: 0, done: 0, idle: 0 },
	title: 'dotfiles',
};

const remotePaged = {
	...paged,
	folders: [],
	key: 'remote:p1',
	serverId: 'remote',
	panels: [
		terminalRow({
			key: 'remote:panel-a',
			serverId: 'remote',
			title: 'deploy',
		}),
	],
	summary: { attention: 0, working: 0, done: 0, idle: 1 },
};

const groups = [
	{
		projects: [paged, dotfiles],
		serverId: 'local',
		serverLabel: 'Marks-MacBook-Air',
	},
];

const switcher = (overrides) =>
	renderToStaticMarkup(
		React.createElement(CompactSwitcher, {
			activePanelKey: 'local:panel-a',
			collapsedFolderIdsFor: () => new Set(),
			currentServer: {
				id: 'local',
				label: 'Marks-MacBook-Air',
				isReachable: true,
			},
			frontProjectKey: 'local:p1',
			groups,
			homeSections: [
				{ section: 'home', summary: 'Overview' },
				{ section: 'tabs', summary: '3 tabs open' },
				{ section: 'bots', summary: 'Bots' },
				{ section: 'automations', summary: 'Runs' },
				{ section: 'workflows', summary: 'Checklists' },
				{ section: 'recordings', summary: 'Recordings' },
			],
			isHomeSelected: false,
			launchers: [
				{ id: 'claude', displayName: 'Claude Code', icon: 'terminal' },
				{ id: 'codex', displayName: 'Codex', icon: 'terminal' },
			],
			rememberedLauncherId: 'shell',
			selectedFolderIdFor: () => 'general',
			onActivateFolder: noop,
			onActivatePanel: noop,
			onAddConnection: noop,
			onClosePanel: noop,
			onCloseProject: noop,
			onCreateTerminal: noop,
			onDismiss: noop,
			onEditProject: noop,
			onFolderMenuAction: noop,
			onMovePanelToFolder: noop,
			onNewProject: noop,
			onOpenHomeSection: noop,
			onRenamePanel: noop,
			onReorderFolders: noop,
			onReorderPanels: noop,
			onReorderProjects: noop,
			onToggleFolderCollapsed: noop,
			...overrides,
		}),
	);

test('the drawer is a dialog holding a rail and a panel', () => {
	const markup = switcher({});
	assert.match(markup, /role="dialog"/);
	assert.match(markup, /aria-label="Switch terminal"/);
	assert.match(markup, /data-compact-drawer="true"/);
	assert.match(markup, /<nav class="compact-drawer__rail" aria-label="Places"/);
});

test('the rail runs server, Home, divider, projects, New project', () => {
	const markup = switcher({});
	const order = [
		'data-compact-switcher-server',
		'data-compact-switcher-home',
		'compact-drawer__rail-divider',
		'data-compact-switcher-project="local:p1"',
		'data-compact-switcher-project="local:p2"',
		'compact-drawer__rail-add',
	].map((marker) => markup.indexOf(marker));
	assert.ok(order.every((index) => index >= 0));
	assert.deepEqual(
		order,
		[...order].sort((left, right) => left - right),
	);
	// The server control names its server, even with one attached.
	assert.match(markup, /aria-label="Server Marks-MacBook-Air"/);
	// One connection: no group headings.
	assert.doesNotMatch(markup, /compact-drawer__rail-heading/);
});

test('rail items carry their badge: attention before working', () => {
	const markup = switcher({});
	assert.match(
		markup,
		/data-compact-switcher-project="local:p1"(?:(?!<\/button>)[\s\S])*compact-drawer__badge--working[^>]*>1</,
	);
	assert.match(
		markup,
		/data-compact-switcher-project="local:p2"(?:(?!<\/button>)[\s\S])*compact-drawer__badge--attention[^>]*>1</,
	);
	// An emoji stands for a project when it has one; initials otherwise.
	assert.match(markup, /compact-drawer__rail-glyph" aria-hidden="true">🔧</);
	assert.match(markup, /compact-drawer__rail-glyph" aria-hidden="true">Pa</);
	// Home counts what needs the user everywhere.
	assert.match(markup, /aria-label="Home, 1 needs you"/);
});

test('two connections head their groups, the window server first', () => {
	const markup = switcher({
		groups: [
			{
				projects: [remotePaged],
				serverId: 'remote',
				serverLabel: 'paged-prod',
			},
			...groups,
		],
	});
	const own = markup.indexOf('>Marks-MacBook-Air</span>');
	const other = markup.indexOf('>paged-prod</span>');
	assert.ok(own >= 0 && other > own);
	assert.ok(
		markup.indexOf('data-compact-switcher-project="local:p1"') <
			markup.indexOf('data-compact-switcher-project="remote:p1"'),
	);
});

test('the drawer opens on the project in front, its tree in folder order', () => {
	const markup = switcher({});
	assert.match(
		markup,
		/data-compact-switcher-project="local:p1"[^>]*|aria-pressed="true"[^>]*data-compact-switcher-project="local:p1"/,
	);
	const order = [
		'>General<',
		'>server<',
		'>mobile-rail<',
		'>claude<',
		'>scratch<',
	].map((text) => markup.indexOf(text));
	assert.ok(
		order.every((index) => index >= 0),
		'every folder and row is listed',
	);
	assert.deepEqual(
		order,
		[...order].sort((left, right) => left - right),
	);
	assert.match(markup, /aria-label="Folder worktree-mobile-rail in Paged"/);
	assert.match(markup, /compact-drawer__folder-glyph/);
});

test('opening on Home presents the sections and what needs you', () => {
	const markup = switcher({
		isHomeSelected: true,
		homeFrontSection: 'workflows',
	});
	assert.match(markup, /data-compact-home-panel="true"/);
	const sections = [
		...markup.matchAll(/data-compact-home-section="(\w+)"/g),
	].map((match) => match[1]);
	assert.deepEqual(sections, [
		'home',
		'tabs',
		'bots',
		'automations',
		'workflows',
		'recordings',
	]);
	assert.match(
		markup,
		/aria-current="page"[^>]*data-compact-home-section="workflows"/,
	);
	assert.match(markup, /data-compact-needs-you="true"/);
	assert.match(markup, />codex</);
	// Home has no edit control and no folder tree.
	assert.doesNotMatch(markup, /data-compact-switcher-edit/);
	assert.doesNotMatch(markup, /data-compact-switcher-folder=/);
	// With Home presented the create bar offers New project alone.
	assert.doesNotMatch(markup, /data-compact-switcher-new-terminal/);
	assert.match(
		markup,
		/compact-drawer__create-wide"[^>]*>(?:(?!<\/button>)[\s\S])*New project/,
	);
});

test('a folder header holds its count, a new-terminal control, and a ⋯ menu', () => {
	const markup = switcher({});
	assert.match(markup, /data-compact-switcher-folder-add="local:folder:wt"/);
	assert.match(
		markup,
		/aria-label="New terminal in worktree-mobile-rail of Paged"/,
	);
	assert.match(markup, /data-compact-switcher-folder-menu="local:folder:wt"/);
	assert.match(markup, /aria-label="More for worktree-mobile-rail"/);
	// An empty folder offers one New terminal entry.
	assert.match(
		markup,
		/data-compact-switcher-empty-folder="local:folder:empty"/,
	);
});

test('every dial sits in the trailing column, and folders carry none', () => {
	const markup = switcher({});
	const rows = markup.match(/class="compact-drawer__row[ "]/g) ?? [];
	const slots = markup.match(/data-compact-workflow-slot="true"/g) ?? [];
	assert.equal(slots.length, rows.length);
	// The folder header's trailing column is the same 30px slot, holding ⋯.
	assert.match(
		markup,
		/compact-drawer__wslot"><button[^>]*compact-drawer__folder-more/,
	);
});

test('a row carries its preview line, and a row without one carries none', () => {
	const markup = switcher({});
	assert.match(markup, /compact-drawer__row-sub">✓ built in 2\.41s</);
	assert.equal(
		(markup.match(/compact-drawer__row-sub/g) ?? []).length,
		1,
		'a terminal with no buffer must show no placeholder',
	);
});

test('the panel on screen is the current row', () => {
	const markup = switcher({});
	assert.match(
		markup,
		/aria-current="true"[^>]*data-compact-switcher-terminal="local:panel-a"/,
	);
});

test('row state uses the shared activity vocabulary, and working is a dot', () => {
	const markup = switcher({});
	assert.match(markup, /agent-status-indicator--working/);
	assert.match(markup, /agent-status-indicator--idle/);
});

test('the panel header summarises its terminals', () => {
	const markup = switcher({});
	assert.match(markup, /data-compact-switcher-summary="local:p1"/);
	assert.match(markup, /aria-label="1 working, 1 idle"/);
	assert.match(
		markup,
		/compact-drawer__summary-group--working">1 working<\/span><span class="compact-drawer__summary-group"> · 1 idle</,
	);
});

test('the split control repeats the remembered launcher and names where it creates', () => {
	const shell = switcher({});
	assert.match(shell, /data-compact-launcher="shell"/);
	assert.match(shell, /compact-drawer__split-label">Terminal</);
	assert.match(shell, /aria-label="New Terminal terminal in General of Paged"/);
	assert.match(shell, /data-compact-switcher-launchers="true"/);
	assert.match(
		shell,
		/compact-drawer__create-icon"[^>]*aria-label="New project"/,
	);
	// Add connection lives in the server menu now.
	assert.doesNotMatch(shell, /aria-label="Add connection"/);

	const codex = switcher({ rememberedLauncherId: 'codex' });
	assert.match(codex, /compact-drawer__split-label">Codex</);
	assert.match(codex, /aria-label="New Codex terminal in General of Paged"/);

	const gone = switcher({ rememberedLauncherId: 'retired' });
	assert.match(gone, /compact-drawer__split-label">Terminal</);
});

test('another server project offers only what switches there first', () => {
	const markup = switcher({
		frontProjectKey: 'remote:p1',
		groups: [
			...groups,
			{
				projects: [remotePaged],
				serverId: 'remote',
				serverLabel: 'paged-prod',
			},
		],
	});
	// The project presented is another server's: no edit control, and its
	// split control starts the default shell whatever this device remembers.
	assert.doesNotMatch(markup, /data-compact-switcher-edit/);
	assert.match(markup, /data-compact-launcher="shell"/);
	assert.match(markup, />deploy</);
});

test("another server's menus offer only what needs no switch", async () => {
	// The menus are layers opened by a press, so their gating is read from the
	// component: a static render never opens one.
	const source = await readFile('src/workspace/CompactSwitcher.tsx', 'utf8');
	const rowLayer = source.slice(
		source.indexOf("if (layer?.kind === 'row')"),
		source.indexOf("layer?.kind === 'folder'"),
	);
	// Open is always offered; Rename, Move and Close only on this server.
	assert.match(rowLayer, /key: 'open'[\s\S]*if \(own\) \{[\s\S]*key: 'rename'/);
	assert.match(rowLayer, /const own = row\.serverId === currentServer\.id;/);
	const folderLayer = source.slice(
		source.indexOf("layer?.kind === 'folder'"),
		source.indexOf("layer?.kind === 'server'"),
	);
	assert.match(
		folderLayer,
		/isOwnServer && props\.folderMenuFor !== undefined[\s\S]*: \[\];/,
	);
	const launchers = source.slice(
		source.indexOf('const launcherItems'),
		source.indexOf('const announce'),
	);
	// Another server gets the default shell alone, and is told where to go.
	assert.match(
		launchers,
		/const ids = \[COMPACT_SHELL_LAUNCHER, \.\.\.\(own \? launcherIds : \[\]\)\];/,
	);
	assert.match(launchers, /Switch to \$\{serverLabelOf\(project\.serverId\)\} for its launchers\./);
	const create = source.slice(
		source.indexOf('const create = ('),
		source.indexOf('const launcherItems'),
	);
	assert.match(create, /project\.serverId === currentServer\.id\s*\?\s*launcherId\s*:\s*COMPACT_SHELL_LAUNCHER/);
});

test("another server's project draws no grips or close controls in its rail", () => {
	const markup = switcher({
		groups: [
			...groups,
			{ projects: [remotePaged], serverId: 'remote', serverLabel: 'paged-prod' },
		],
	});
	assert.doesNotMatch(
		markup,
		/data-compact-switcher-close-project="remote:p1"/,
	);
});

test('the filter starts collapsed and takes no focus', () => {
	const markup = switcher({});
	assert.match(markup, /aria-label="Search terminals and projects"/);
	assert.doesNotMatch(markup, /<input/);
	assert.doesNotMatch(markup, /autoFocus|autofocus/);
});

test('the drawer opens on Tabs when it presents the project in front', () => {
	const markup = switcher({
		agents: React.createElement('div', { className: 'agents-probe' }, 'agent'),
	});
	assert.match(markup, /role="tablist"/);
	const tabs = [...markup.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map(
		([tab]) => tab,
	);
	assert.deepEqual(
		tabs.map((tab) => /aria-label="(\w+)"/.exec(tab)?.[1]),
		['Tabs', 'Agents'],
	);
	assert.match(tabs[0], /aria-selected="true"/);
	assert.doesNotMatch(markup, /agents-probe/);
});

test('no tab bar without agents content, or for a background project', () => {
	assert.doesNotMatch(switcher({}), /role="tablist"/);
	assert.doesNotMatch(
		switcher({
			frontProjectKey: 'local:p2',
			agents: React.createElement('div', null, 'agent'),
			isHomeSelected: true,
		}),
		/role="tablist"/,
	);
});

test('a rail project is the long-press target for editing it', () => {
	const markup = switcher({});
	assert.match(markup, /title="Long-press to edit project"/);
	assert.match(markup, /aria-label="Paged"/);
});

test('rows open their menu by long press, secondary click, or the keyboard', async () => {
	const source = await readFile('src/workspace/CompactSwitcher.tsx', 'utf8');
	assert.match(
		source,
		/event\.key === 'ContextMenu' \|\| \(event\.key === 'F10' && event\.shiftKey\)/,
	);
	const component = source.slice(
		source.indexOf('function PanelRow('),
		source.indexOf('function FolderSection('),
	);
	// bindClick lets a completed long press swallow the click that follows it.
	assert.match(component, /onClick=\{longPress\.bindClick\(/);
	assert.match(component, /useMenuGesture\(onMenu, isEditing\)/);
	assert.match(component, /aria-haspopup="menu"/);
});

test('the dismiss key closes the topmost layer first', async () => {
	const source = await readFile('src/workspace/CompactSwitcher.tsx', 'utf8');
	assert.match(
		source,
		/if \(layerRef\.current !== null\) closeLayerRef\.current\(\);\s*else if \(searchOpenRef\.current\) closeSearchRef\.current\(\);\s*else onDismiss\(\);/,
	);
	// A drag in progress owns the key.
	assert.match(source, /gripDragState\.active/);
});

test('the entrance is the drawer alone, and reduced motion removes it', async () => {
	const css = await readFile('src/workspace/CompactSwitcher.css', 'utf8');
	const animated = [
		...css.matchAll(
			/\n(\.[\w-]+(?:[^{]*))\{[^}]*animation:\s*compact-drawer-in/g,
		),
	];
	assert.equal(animated.length, 1);
	assert.match(animated[0][1], /^\.compact-drawer\s*$/);
	assert.match(
		css,
		/@media \(prefers-reduced-motion: reduce\) \{\s*\.compact-drawer \{\s*animation: none;/,
	);
});

test('a workflow step line names the step being worked on or waiting', () => {
	const view = (steps) => ({
		state: 'attached',
		workflow: { steps },
	});
	assert.equal(workflowStepLine(undefined), undefined);
	assert.equal(
		workflowStepLine(
			view([
				{ status: 'done', title: 'Propose' },
				{ status: 'needs_input', title: 'Review' },
				{ status: 'not_started', title: 'Ship' },
			]),
		),
		'Needs input · 2/3 Review',
	);
	assert.equal(
		workflowStepLine(
			view([
				{ status: 'done', title: 'Propose' },
				{ status: 'running', title: 'Implement' },
			]),
		),
		'2/2 Implement',
	);
	assert.equal(
		workflowStepLine(view([{ status: 'done', title: 'Propose' }])),
		'All 1 step done',
	);
});

/* ------------------------------------------------------------ the wiring */

test('the drawer is given agents only for a project in front with agents on', async () => {
	const app = await readFile('src/App.tsx', 'utf8');
	const wiring = app.slice(
		app.indexOf('<CompactSwitcher'),
		app.indexOf('onActivatePanel={(row) => {'),
	);
	assert.match(wiring, /settings\.agentIntegration\.enabled/);
	assert.match(wiring, /!isHomeSelected/);
	assert.match(wiring, /activeProject !== null/);
	assert.match(app, /onCompactAgentActivated=\{closeCompactSwitcher\}/);
});

test('editing a switcher panel names the panel rather than racing activation', async () => {
	const app = await readFile('src/App.tsx', 'utf8');
	const handler = app.slice(
		app.indexOf('const editCompactSwitcherPanel'),
		app.indexOf('const closeCompactSwitcherPanel'),
	);
	assert.match(handler, /activateCompactSwitcherPanel\(row\)/);
	assert.match(
		handler,
		/'terminay-edit-terminal',\s*\{\s*detail: \{ panelId: row\.panelId \}/,
	);
	assert.doesNotMatch(handler, /requestAnimationFrame|setTimeout/);
});

test('closing a switcher panel uses the hidden tab close events', async () => {
	const app = await readFile('src/App.tsx', 'utf8');
	const handler = app.slice(
		app.indexOf('const closeCompactSwitcherPanel'),
		app.indexOf('const createCompactSwitcherTerminal'),
	);
	assert.match(handler, /terminay-request-close-terminal/);
	assert.match(handler, /terminay-request-close-file/);
	assert.match(handler, /panelId: row\.panelId/);
	assert.match(handler, /sessionId: row\.sessionId/);
});

test('closing a switcher project uses the project tab close path', async () => {
	const app = await readFile('src/App.tsx', 'utf8');
	const wiring = app.slice(
		app.indexOf('<CompactSwitcher'),
		app.indexOf('onDismiss={closeCompactSwitcher}'),
	);
	assert.match(wiring, /onCloseProject=\{\(group\) => \{/);
	assert.match(wiring, /closeComposedTab\(/);
});

test('folder actions in the drawer are the Folders tree context menu', async () => {
	const app = await readFile('src/App.tsx', 'utf8');
	assert.match(app, /describeFolderMenuRef\.current = describeFolderMenu;/);
	const handler = app.slice(
		app.indexOf('const runCompactFolderAction'),
		app.indexOf('const reportCompactError'),
	);
	// Run in the folder's own workspace, brought to the front first.
	assert.match(handler, /runInFolderWorkspace\(/);
	assert.match(
		handler,
		/workspace\.folderMenu\(folder\.folderId\)\?\.run\(action, anchor\)/,
	);
	const controller = await readFile(
		'src/workspace/useFolderMenuController.tsx',
		'utf8',
	);
	assert.match(controller, /entries=\{shownMenu\.entries\}/);
});

test('the Home toggle returns to the project Home keeps as its command target', async () => {
	const app = await readFile('src/App.tsx', 'utf8');
	const handler = app.slice(
		app.indexOf('const toggleCompactHome'),
		app.indexOf('const compactRememberedLauncher'),
	);
	assert.match(handler, /selectHome\(\)/);
	// A project that has gone since leaves Home selected.
	assert.match(
		handler,
		/projectsRef\.current\.some\(\(project\) => project\.id === activeProjectId\)/,
	);
	assert.match(handler, /activateProject\(activeProjectId\)/);
});
