import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * The Board's Untracked column, as rendered: it starts collapsed with its
 * count showing, opens from a control in its header, and its cards carry no
 * status.
 */

const require = createRequire(import.meta.url);
const testDirectory = await mkdtemp(join(process.cwd(), '.dashboard-untracked-ui-test-'));
test.after(() => rm(testDirectory, { force: true, recursive: true }));

const outputPath = join(testDirectory, 'workspace-dashboard.cjs');
await build({
	entryPoints: ['src/workspace/WorkspaceDashboard.tsx'],
	outfile: outputPath,
	bundle: true,
	format: 'cjs',
	platform: 'node',
	external: ['react'],
	loader: { '.css': 'empty' },
	logLevel: 'silent',
});
const { WorkspaceDashboard } = require(outputPath);

function storage(values) {
	return {
		getItem: (key) => (key in values ? values[key] : null),
		setItem: (key, value) => {
			values[key] = String(value);
		},
	};
}

const entry = (panelId, overrides) => ({
	color: '#336699',
	emoji: '',
	isAgentStatus: false,
	kind: 'terminal',
	panelId,
	projectEmoji: '',
	projectId: 'p-a',
	projectTitle: 'Terminay',
	sessionId: `s-${panelId}`,
	status: 'idle',
	title: panelId,
	...overrides,
});

const sources = [
	{
		serverId: 'srv-1',
		serverLabel: 'Local',
		projects: [{ color: '#336699', emoji: '', id: 'p-a', title: 'Terminay' }],
		inventoryByProject: {
			'p-a': [
				entry('caffeinate', { indicatorsSuppressed: true, untracked: true }),
				entry('build', { status: 'recent' }),
			],
		},
		agentsByProject: {},
	},
];

function render(values) {
	globalThis.localStorage = storage({
		'terminay.view.dashboard-mode.v1': 'board',
		...values,
	});
	try {
		return renderToStaticMarkup(
			React.createElement(WorkspaceDashboard, {
				onActivate: () => {},
				onActivateAgent: () => {},
				sources,
			}),
		);
	} finally {
		delete globalThis.localStorage;
	}
}

function untrackedColumn(markup) {
	const start = markup.indexOf('data-terminay-dashboard-column="untracked"');
	assert.notEqual(start, -1, 'the Untracked column is rendered');
	const end = markup.indexOf('</section>', start);
	return markup.slice(start, end);
}

test('the Untracked column starts collapsed and still names its count', () => {
	const markup = render({});
	const column = untrackedColumn(markup);
	assert.match(column, /data-terminay-dashboard-column-collapsed="true"/);
	assert.match(column, /aria-expanded="false"/);
	assert.match(column, /aria-label="Untracked, 1 tab\. Expand"/);
	assert.doesNotMatch(column, /data-terminay-dashboard-panel="caffeinate"/);
	// It is in no other column either, and the summary counts it apart.
	assert.doesNotMatch(markup, /data-terminay-dashboard-panel="caffeinate"/);
	assert.match(markup, /data-terminay-dashboard-summary="untracked"/);
	// Columns read in order, Untracked last.
	const order = [...markup.matchAll(/data-terminay-dashboard-column="(\w+)"/g)].map(
		(match) => match[1],
	);
	assert.deepEqual(order, ['idle', 'working', 'attention', 'done', 'untracked']);
});

test('an opened Untracked column shows its cards without a status', () => {
	const column = untrackedColumn(
		render({ 'terminay.view.dashboard-board-untracked-collapsed.v1': 'false' }),
	);
	assert.match(column, /aria-expanded="true"/);
	assert.match(column, /data-terminay-dashboard-panel="caffeinate"/);
	assert.doesNotMatch(column, /agent-status-indicator/);
	assert.match(column, /untracked<\/span>/);
});

test('grouped by project, every lane keeps the Untracked column', () => {
	const markup = render({
		'terminay.view.dashboard-board-grouped.v1': 'true',
		'terminay.view.dashboard-board-untracked-collapsed.v1': 'false',
	});
	assert.match(markup, /data-terminay-dashboard-board-grouped="true"/);
	const cell = markup.slice(
		markup.indexOf('data-terminay-dashboard-column="untracked"', markup.indexOf('data-terminay-dashboard-lane=')),
	);
	assert.match(cell, /^[^>]*data-terminay-dashboard-column-collapsed="false"/);
	assert.match(cell, /data-terminay-dashboard-panel="caffeinate"/);
});
