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

const { CompactChromeRow } = await bundleComponent(
	'src/workspace/CompactChromeRow.tsx',
	'compact-chrome-row.cjs',
);
const { CompactSwitcher } = await bundleComponent(
	'src/workspace/CompactSwitcher.tsx',
	'compact-switcher.cjs',
);

test.after(() => rm(testDirectory, { force: true, recursive: true }));

const noop = () => {};

const row = (overrides) =>
	renderToStaticMarkup(
		React.createElement(CompactChromeRow, {
			connection: {
				isExposed: false,
				isReachable: true,
				serverLabel: 'Marks-MacBook-Air',
				tone: 'remote-access-button--idle',
			},
			isCommandBarAvailable: true,
			isExplorerOpen: false,
			isHomeSelected: false,
			isSwitcherOpen: false,
			onOpenCommandBar: noop,
			onOpenSwitcher: noop,
			onShowDashboard: noop,
			onToggleExplorer: noop,
			projectColor: '#7c5cff',
			projectTitle: 'Paged',
			terminalTitle: 'server',
			...overrides,
		}),
	);

test('the compact row holds its six controls in order', () => {
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
		'aria-label="Home"',
		'data-compact-command-bar',
		'compact-breadcrumb',
		'data-compact-connection',
	];
	let cursor = -1;
	for (const marker of order) {
		const next = markup.indexOf(marker);
		assert.ok(next > cursor, `${marker} is out of order`);
		cursor = next;
	}
});

test('a host with native menus contributes no menu control', () => {
	const markup = row({});
	assert.doesNotMatch(markup, /connected-web-compact-menu/);
	// The rest of the row is unchanged by the menu's absence.
	assert.match(markup, /data-compact-breadcrumb="true"/);
});

test('the breadcrumb names the project and the terminal', () => {
	const markup = row({});
	assert.match(markup, /data-compact-breadcrumb-segment="project"[^>]*>Paged</);
	assert.match(
		markup,
		/data-compact-breadcrumb-segment="terminal"[^>]*>server</,
	);
	assert.match(markup, /aria-label="Switch terminal — Paged, server"/);
	assert.match(markup, /aria-haspopup="dialog"/);
});

test('a project with no terminal in front still names the project', () => {
	const markup = row({ terminalTitle: undefined });
	assert.match(markup, />Paged</);
	assert.doesNotMatch(markup, /data-compact-breadcrumb-segment="terminal"/);
	assert.match(markup, /aria-label="Switch terminal — Paged"/);
});

test('the connection control shows a glyph and keeps its server name for AT', () => {
	const markup = row({});
	// No visible label, and the tone the wide bar carries is preserved.
	assert.doesNotMatch(markup, /compact-connection[^>]*>[^<]*Marks-MacBook-Air/);
	assert.match(markup, /aria-label="Connections — Marks-MacBook-Air, Offline"/);
	assert.match(markup, /remote-access-button--idle/);
	assert.match(markup, /compact-connection__dot/);
});

test('an unreachable connection is marked on its dot', () => {
	const markup = row({
		connection: {
			isExposed: true,
			isReachable: false,
			serverLabel: 'paged-prod',
			tone: 'remote-access-button--active',
		},
	});
	assert.match(markup, /compact-connection__dot--unreachable/);
	assert.match(markup, /aria-label="Connections — paged-prod, Exposed"/);
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
});

const groups = [
	{
		projects: [
			{
				color: '#7c5cff',
				emoji: '',
				// A project whose folders this window does not know.
				folders: [],
				key: 'local:p1',
				projectId: 'p1',
				serverId: 'local',
				panels: [
					{
						isAgentStatus: false,
						key: 'local:panel-a',
						panelId: 'panel-a',
						panelKind: 'terminal',
						preview: '✓ built in 2.41s',
						projectId: 'p1',
						serverId: 'local',
						sessionId: 's-a',
						state: 'idle',
						title: 'server',
					},
					{
						isAgentStatus: true,
						key: 'local:panel-b',
						panelId: 'panel-b',
						panelKind: 'terminal',
						projectId: 'p1',
						serverId: 'local',
						sessionId: 's-b',
						state: 'working',
						title: 'claude',
					},
				],
				summary: { attention: 0, working: 1, done: 0, idle: 1 },
				title: 'Paged',
			},
		],
		serverId: 'local',
		serverLabel: 'Marks-MacBook-Air',
	},
];

const switcher = (overrides) =>
	renderToStaticMarkup(
		React.createElement(CompactSwitcher, {
			activePanelKey: 'local:panel-a',
			groups,
			onActivatePanel: noop,
			onAddConnection: noop,
			onClosePanel: noop,
			onCloseProject: noop,
			onDismiss: noop,
			onEditProject: noop,
			onEditPanel: noop,
			onNewProject: noop,
			onNewTerminal: noop,
			onNewTerminalInFolder: noop,
			onQueryChange: noop,
			query: '',
			...overrides,
		}),
	);

test('the switcher groups terminals under their project and connection', () => {
	const markup = switcher({});
	const connection = markup.indexOf('Marks-MacBook-Air');
	const project = markup.indexOf('Paged');
	const terminal = markup.indexOf('>server<');
	assert.ok(connection >= 0 && connection < project);
	assert.ok(project < terminal);
	assert.match(markup, /role="dialog"/);
	assert.match(markup, /aria-label="Switch terminal"/);
});

test('a project with several folders lists each folder with its terminals beneath it', () => {
	const [connection] = groups;
	const [project] = connection.projects;
	const [server, claude] = project.panels;
	const folder = (folderId, name, panels) => ({
		folderId,
		key: `local:folder:${folderId}`,
		name,
		panels,
	});
	const markup = switcher({
		groups: [
			{
				...connection,
				projects: [
					{
						...project,
						folders: [
							folder('general', 'General', [server]),
							folder('release', 'release-notes', [claude]),
							folder('idle', 'one-window', []),
						],
					},
				],
			},
		],
	});
	const order = ['>General<', '>server<', '>release-notes<', '>claude<', '>one-window<'].map(
		(text) => markup.indexOf(text),
	);
	assert.ok(order.every((index) => index >= 0), 'every folder and terminal is listed');
	assert.deepEqual(order, [...order].sort((left, right) => left - right));
	assert.equal(markup.match(/class="compact-switcher__folder"/g).length, 3);
	// A folder with nothing in it is its label and nothing else.
	assert.doesNotMatch(markup, /No panels/);
	assert.match(
		markup,
		/>one-window<\/span><span class="compact-switcher__folder-rule"[^>]*><\/span><\/button><button[^>]*aria-label="New terminal in one-window of Paged"[^>]*>(?:(?!<button)[\s\S])*<\/button><\/div><\/div>/,
		'nothing follows an empty folder line inside its group',
	);
	assert.match(markup, /aria-label="Folder release-notes in Paged"/);
	// Each folder creates in itself, so the header has no control of its own.
	for (const name of ['General', 'release-notes', 'one-window'])
		assert.match(
			markup,
			new RegExp(`aria-label="New terminal in ${name} of Paged"`),
		);
	assert.doesNotMatch(markup, /aria-label="New terminal in Paged"/);
	// Each terminal is listed once, under its folder.
	assert.equal(markup.match(/>claude</g).length, 1);
});

test('a project with only its General folder still labels it', () => {
	const [connection] = groups;
	const [project] = connection.projects;
	const markup = switcher({
		groups: [
			{
				...connection,
				projects: [
					{
						...project,
						folders: [
							{
								folderId: 'general',
								key: 'local:folder:general',
								name: 'General',
								panels: project.panels,
							},
						],
					},
				],
			},
		],
	});
	assert.equal(markup.match(/class="compact-switcher__folder"/g).length, 1);
	assert.ok(markup.indexOf('>General<') < markup.indexOf('>server<'));
	assert.match(markup, /aria-label="New terminal in General of Paged"/);
});

test('everything of a project sits inside its own card and no other', () => {
	const [connection] = groups;
	const [project] = connection.projects;
	const other = {
		...project,
		color: '#4fd08a',
		folders: [
			{
				folderId: 'g2',
				key: 'local:folder:g2',
				name: 'scratch',
				panels: [
					{
						...project.panels[0],
						key: 'local:panel-z',
						panelId: 'panel-z',
						projectId: 'p2',
						title: 'zsh',
					},
				],
			},
		],
		key: 'local:p2',
		projectId: 'p2',
		title: 'dotfiles',
	};
	const markup = switcher({
		groups: [{ ...connection, projects: [project, other] }],
	});
	const cards = markup.split('class="compact-switcher__card"').slice(1);
	assert.equal(cards.length, 2);
	const [first, second] = cards;
	assert.match(first, /data-compact-switcher-card="local:p1"/);
	assert.match(first, />server</);
	assert.match(first, />claude</);
	assert.doesNotMatch(first, />zsh<|>scratch</);
	assert.match(second, /data-compact-switcher-card="local:p2"/);
	assert.match(second, />scratch</);
	assert.match(second, />zsh</);
	assert.doesNotMatch(second, />server<|>claude</);
	// The card carries the colour once; nothing inside repeats it.
	assert.match(first, /--compact-switcher-project:#7c5cff/);
	assert.match(second, /--compact-switcher-project:#4fd08a/);
});

test('a row carries its preview line, and a row without one carries none', () => {
	const markup = switcher({});
	assert.match(
		markup,
		/compact-switcher__terminal-preview">✓ built in 2\.41s</,
	);
	assert.equal(
		markup.match(/compact-switcher__terminal-preview/g).length,
		1,
		'a terminal with no buffer must show no placeholder',
	);
});

test('the terminal in front is the current row', () => {
	const markup = switcher({});
	assert.match(
		markup,
		/data-compact-switcher-terminal="local:panel-a"[^>]*aria-current="true"|aria-current="true"[^>]*data-compact-switcher-terminal="local:panel-a"/,
	);
});

test('row state uses the shared activity vocabulary', () => {
	const markup = switcher({});
	// Both states use the shared vocabulary; idle is neutral, not absent, so a
	// run of rows keeps one left margin.
	assert.match(markup, /agent-status-indicator--working/);
	assert.match(markup, /agent-status-indicator--idle/);
});

test('the project header summarises its terminals and carries no dot', () => {
	const markup = switcher({});
	assert.match(markup, /data-compact-switcher-summary="local:p1"/);
	assert.match(markup, /aria-label="1 working, 1 idle"/);
	assert.match(
		markup,
		/compact-switcher__summary-group--working">1 working<\/span><span class="compact-switcher__summary-group"> · 1 idle</,
	);
	assert.doesNotMatch(markup, /project-tab-activity-dot/);
	// The header still carries what editing and closing address.
	assert.match(markup, /data-compact-switcher-project="local:p1"/);
	const header = markup.slice(
		markup.indexOf('class="compact-switcher__project"'),
		markup.indexOf('class="compact-switcher__row"'),
	);
	const order = [
		'compact-switcher__project-swatch',
		'compact-switcher__project-name',
		'compact-switcher__summary',
		'aria-label="Close Paged"',
	].map((marker) => header.indexOf(marker));
	assert.ok(order.every((index) => index >= 0));
	assert.deepEqual(order, [...order].sort((left, right) => left - right));
});

test('a project with no terminal shows no summary', () => {
	const [connection] = groups;
	const [project] = connection.projects;
	const markup = switcher({
		groups: [
			{
				...connection,
				projects: [
					{
						...project,
						summary: { attention: 0, working: 0, done: 0, idle: 0 },
					},
				],
			},
		],
	});
	assert.doesNotMatch(markup, /compact-switcher__summary/);
});

const front = { color: '#7c5cff', folderName: 'General', projectTitle: 'Paged' };

test('every create action survives the collapse', () => {
	const markup = switcher({ front, onNewTerminalHere: noop });
	// A project whose folders are not listed creates from its header.
	assert.match(markup, /aria-label="New terminal in Paged"/);
	// The bar says where its terminal will land, in words and for AT.
	assert.match(
		markup,
		/compact-switcher__create-label">Terminal<span class="compact-switcher__create-where"> in Paged › General<\/span>/,
	);
	assert.match(markup, /aria-label="New terminal in General of Paged"/);
	assert.match(markup, /data-compact-switcher-new-terminal="true"/);
	assert.match(markup, /compact-switcher__create-icon"[^>]*aria-label="New project"/);
	assert.match(
		markup,
		/compact-switcher__create-icon"[^>]*aria-label="Add connection"/,
	);
});

test('the create bar names only the project when its folders are unknown', () => {
	const markup = switcher({
		front: { color: '#7c5cff', projectTitle: 'Paged' },
		onNewTerminalHere: noop,
	});
	assert.match(
		markup,
		/compact-switcher__create-where"> in Paged<\/span>/,
	);
});

test('a connection heading carries its rule', () => {
	const markup = switcher({});
	assert.match(markup, /compact-switcher__connection-rule/);
});

test('with no project in front New project is the wide control', () => {
	const markup = switcher({});
	assert.doesNotMatch(markup, /data-compact-switcher-new-terminal/);
	assert.match(
		markup,
		/class="compact-switcher__create-main"[^>]*>(?:(?!<\/button>)[\s\S])*>New project</,
	);
	// New project is offered once, and Add connection sits beside it.
	assert.equal(markup.match(/New project/g).length, 1);
	assert.match(
		markup,
		/compact-switcher__create-icon"[^>]*aria-label="Add connection"/,
	);
});

test('a filter that matches nothing says so and keeps its create bar', () => {
	const markup = switcher({
		front,
		groups: [],
		onNewTerminalHere: noop,
		query: 'nothing-here',
	});
	assert.match(markup, /Nothing matches/);
	assert.match(markup, /data-compact-switcher-new-terminal="true"/);
	// The front project is filtered out of the list and still named here.
	assert.match(markup, /in Paged › General/);
	assert.match(markup, /aria-label="New project"/);
	assert.match(markup, /aria-label="Add connection"/);
});

test('the filter starts collapsed and takes no focus', () => {
	const markup = switcher({});
	// A collapsed control, not a field: opening the sheet must not raise a
	// keyboard, and nothing here is autofocused.
	assert.match(markup, /compact-switcher__search-open/);
	assert.match(markup, /aria-label="Search terminals and projects"/);
	assert.doesNotMatch(markup, /<input/);
	assert.doesNotMatch(markup, /autoFocus|autofocus/);
});

test('the switcher opens on Tabs', () => {
	const markup = switcher({
		agents: React.createElement('div', { className: 'agents-probe' }, 'agent'),
	});
	// The left column's two tabs, named, with Tabs the one selected.
	assert.match(markup, /role="tablist"/);
	const tabs = [...markup.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map(
		([tab]) => tab,
	);
	assert.deepEqual(
		tabs.map((tab) => /aria-label="(\w+)"/.exec(tab)?.[1]),
		['Tabs', 'Agents'],
	);
	assert.match(tabs[0], /aria-selected="true"/);
	assert.match(tabs[1], /aria-selected="false"/);
	// Tabs is the switcher as it always was: the list, the filter, the create bar.
	assert.match(markup, />server</);
	assert.match(markup, /compact-switcher__search-open/);
	assert.match(markup, /aria-label="Add connection"/);
	// The agents are behind their tab, not beneath the list.
	assert.doesNotMatch(markup, /agents-probe/);
	assert.doesNotMatch(markup, /<input/);
});

test('no tab bar without agents content', () => {
	const markup = switcher({});
	assert.doesNotMatch(markup, /role="tablist"/);
	assert.doesNotMatch(markup, /role="tab"/);
	assert.doesNotMatch(markup, /role="tabpanel"/);
	assert.match(markup, />server</);
});

test('the switcher is given agents only for a project in front with agents on', async () => {
	const app = await readFile('src/App.tsx', 'utf8');
	const wiring = app.slice(
		app.indexOf('<CompactSwitcher'),
		app.indexOf('onActivatePanel={(row) => {'),
	);
	assert.match(wiring, /settings\.agentIntegration\.enabled/);
	assert.match(wiring, /!isHomeSelected/);
	assert.match(wiring, /activeProject !== null/);
	// A press on an agent's row dismisses the sheet, as a panel row's does.
	assert.match(app, /onCompactAgentActivated=\{closeCompactSwitcher\}/);
});

test('a project heading is the long-press target for editing', () => {
	const markup = switcher({});
	assert.match(markup, /data-compact-switcher-project="local:p1"/);
	assert.match(markup, /title="Long-press to edit project"/);
});

test('a terminal row is the long-press target for editing that terminal', () => {
	// Long-pressing a terminal tab opened its editor; no tab strip is drawn at
	// this width, so the row that replaced it carries the gesture.
	const markup = switcher({});
	assert.match(markup, /data-compact-switcher-terminal="local:panel-a"/);
	// Tab rows carry no hover tooltip.
	assert.doesNotMatch(markup, /title="Long-press to edit tab"/);
});

test('a short press on a terminal row still activates it', async () => {
	const source = await readFile('src/workspace/CompactSwitcher.tsx', 'utf8');
	const component = source.slice(
		source.indexOf('function CompactSwitcherPanel('),
		source.indexOf('function CompactSwitcherProjectHeading('),
	);
	// bindClick is what lets a completed long press swallow the click that
	// follows it, so activation and editing cannot both fire from one press.
	assert.match(component, /onClick=\{longPress\.bindClick\(onActivate\)\}/);
	assert.match(component, /const longPress = useLongPress\(onEdit\);/);
	// Close is a sibling button, not nested inside the activate target.
	assert.match(component, /className="compact-switcher__row"/);
	assert.match(component, /className="compact-switcher__close"/);
	assert.match(component, /aria-label=\{`Close \$\{panel\.title\}`\}/);
	assert.match(component, /onClick=\{onClose\}/);
});

test('each project heading carries a close control beside new terminal', () => {
	const markup = switcher({});
	assert.match(markup, /aria-label="Close Paged"/);
	assert.match(markup, /aria-label="New terminal in Paged"/);
});

test('editing a switcher panel names the panel rather than racing activation', async () => {
	const app = await readFile('src/App.tsx', 'utf8');
	const handler = app.slice(
		app.indexOf('const editCompactSwitcherPanel'),
		app.indexOf('const closeCompactSwitcherPanel'),
	);
	assert.match(handler, /activateCompactSwitcherPanel\(row\)/);
	// The panel is named, so a project that does not hold it ignores the event
	// and no ordering between activation and edit has to hold.
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
	assert.doesNotMatch(handler, /closePanel\(/);
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
