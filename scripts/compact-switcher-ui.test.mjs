import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
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
			isExplorerOpen: false,
			isHomeSelected: false,
			isSwitcherOpen: false,
			onOpenSwitcher: noop,
			onShowDashboard: noop,
			onToggleExplorer: noop,
			projectColor: '#7c5cff',
			projectTitle: 'Paged',
			terminalTitle: 'server',
			...overrides,
		}),
	);

test('the compact row holds its five controls in order', () => {
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
		'Show dashboard',
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
				badge: { count: 2, state: 'recent' },
				color: '#7c5cff',
				emoji: '',
				key: 'local:p1',
				projectId: 'p1',
				serverId: 'local',
				terminals: [
					{
						isAgentStatus: false,
						key: 'local:panel-a',
						panelId: 'panel-a',
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
						projectId: 'p1',
						serverId: 'local',
						sessionId: 's-b',
						state: 'working',
						title: 'claude',
					},
				],
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
			activeTerminalKey: 'local:panel-a',
			groups,
			onActivateTerminal: noop,
			onAddConnection: noop,
			onDismiss: noop,
			onEditProject: noop,
			onNewProject: noop,
			onNewTerminal: noop,
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
	// `working` shows the shared indicator; `idle` stays neutral.
	assert.match(markup, /agent-status-indicator--working/);
	assert.doesNotMatch(markup, /agent-status-indicator--idle/);
});

test('the project heading carries its activity badge', () => {
	const markup = switcher({});
	assert.match(markup, /project-tab-activity-badge--recent[^>]*>|>2</);
});

test('every create action survives the collapse', () => {
	const markup = switcher({});
	assert.match(markup, /aria-label="New terminal in Paged"/);
	assert.match(markup, />New project</);
	assert.match(markup, />Add connection</);
});

test('a filter that matches nothing says so and keeps its actions', () => {
	const markup = switcher({ groups: [], query: 'nothing-here' });
	assert.match(markup, /Nothing matches/);
	assert.match(markup, />New project</);
	assert.match(markup, />Add connection</);
});

test('the filter field is labelled', () => {
	const markup = switcher({});
	assert.match(markup, /aria-label="Search terminals and projects"/);
});

test('a project heading is the long-press target for editing', () => {
	const markup = switcher({});
	assert.match(markup, /data-compact-switcher-project="local:p1"/);
	assert.match(markup, /title="Long-press to edit project"/);
});
