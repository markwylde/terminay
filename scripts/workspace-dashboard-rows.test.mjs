import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildDashboardRows,
	dashboardStatusFor,
	resolveDashboardActivation,
} from '../src/workspace/dashboardRows.ts';

const projects = [
	{ color: '#336699', emoji: '🟩', id: 'p-a', title: 'Terminay' },
	{ color: '#993366', emoji: '🟦', id: 'p-b', title: 'Books' },
];

function entry(overrides) {
	return {
		color: '#336699',
		emoji: '',
		isAgentStatus: false,
		kind: 'terminal',
		panelId: 'panel-1',
		projectEmoji: '🟩',
		projectId: 'p-a',
		projectTitle: 'Terminay',
		status: 'idle',
		title: 'zsh',
		...overrides,
	};
}

test('projects come in order, each followed by its panels in panel order', () => {
	const rows = buildDashboardRows(projects, {
		'p-a': [
			entry({ panelId: 'panel-1', sessionId: 's1', title: 'Claude Code' }),
			entry({ kind: 'file', panelId: 'panel-2', title: 'server.ts' }),
		],
		'p-b': [
			entry({
				panelId: 'panel-3',
				projectId: 'p-b',
				sessionId: 's3',
				title: 'zsh',
			}),
		],
	});

	assert.deepEqual(
		rows.map((row) => [
			row.kind,
			row.kind === 'project' ? row.title : row.panelId,
		]),
		[
			['project', 'Terminay'],
			['panel', 'panel-1'],
			['panel', 'panel-2'],
			['project', 'Books'],
			['panel', 'panel-3'],
		],
	);
});

test('a project with no panels still gets its header row', () => {
	const rows = buildDashboardRows(projects, { 'p-a': [] });

	assert.equal(rows.length, 2);
	assert.deepEqual(
		rows.map((row) => row.kind),
		['project', 'project'],
	);
	assert.equal(rows[0].counts.panels, 0);
});

test('a quiet workspace still lists every project and panel', () => {
	const rows = buildDashboardRows(projects, {
		'p-a': [entry({ sessionId: 's1' })],
		'p-b': [entry({ panelId: 'panel-2', projectId: 'p-b', sessionId: 's2' })],
	});

	assert.equal(rows.length, 4);
	assert.deepEqual(
		rows.filter((row) => row.kind === 'panel').map((row) => row.status),
		['idle', 'idle'],
	);
});

test('the project header rolls up its panels', () => {
	const rows = buildDashboardRows(projects, {
		'p-a': [
			entry({
				isAgentStatus: true,
				panelId: 'a',
				sessionId: 's1',
				status: 'working',
			}),
			entry({
				isAgentStatus: true,
				panelId: 'b',
				sessionId: 's2',
				status: 'waiting',
			}),
			entry({
				isAgentStatus: true,
				panelId: 'c',
				sessionId: 's3',
				status: 'blocked',
			}),
			entry({ panelId: 'd', sessionId: 's4', status: 'unviewed' }),
			entry({ panelId: 'e', sessionId: 's5' }),
		],
	});

	assert.deepEqual(rows[0].counts, {
		attention: 2,
		done: 1,
		panels: 5,
		working: 1,
	});
});

test('raw-output states are shown in the canonical vocabulary', () => {
	assert.equal(dashboardStatusFor('idle'), 'idle');
	assert.equal(dashboardStatusFor('recent'), 'working');
	assert.equal(dashboardStatusFor('unviewed'), 'done');
	assert.equal(dashboardStatusFor('attention'), 'blocked');
	assert.equal(dashboardStatusFor('waiting'), 'waiting');
	assert.equal(dashboardStatusFor('working'), 'working');
});

test('an agent-owned terminal shows its agent state, not a raw-output state', () => {
	const rows = buildDashboardRows(projects, {
		'p-a': [
			entry({
				isAgentStatus: true,
				sessionId: 's1',
				status: 'waiting',
				title: 'Claude Code',
			}),
		],
	});

	const panel = rows[1];
	assert.equal(panel.status, 'waiting');
	assert.equal(panel.isAgentStatus, true);
});

test('panel rows carry their kind so file and folder rows can be marked', () => {
	const rows = buildDashboardRows(projects, {
		'p-a': [
			entry({ panelId: 'a', sessionId: 's1' }),
			entry({ kind: 'file', panelId: 'b', title: 'a.ts' }),
			entry({ kind: 'folder', panelId: 'c', title: 'src' }),
		],
	});

	assert.deepEqual(
		rows.filter((row) => row.kind === 'panel').map((row) => row.panelKind),
		['terminal', 'file', 'folder'],
	);
});

test('activating a project row resolves to that project', () => {
	const inventory = { 'p-a': [entry({ sessionId: 's1' })] };
	const rows = buildDashboardRows(projects, inventory);

	assert.deepEqual(resolveDashboardActivation(rows[0], projects, inventory), {
		kind: 'project',
		projectId: 'p-a',
	});
});

test('activating a panel row resolves to its project and session', () => {
	const inventory = { 'p-a': [entry({ sessionId: 's1' })] };
	const rows = buildDashboardRows(projects, inventory);

	assert.deepEqual(resolveDashboardActivation(rows[1], projects, inventory), {
		kind: 'panel',
		panelId: 'panel-1',
		projectId: 'p-a',
		sessionId: 's1',
	});
});

test('a row whose panel has gone is stale', () => {
	const inventory = { 'p-a': [entry({ sessionId: 's1' })] };
	const rows = buildDashboardRows(projects, inventory);

	assert.deepEqual(
		resolveDashboardActivation(rows[1], projects, { 'p-a': [] }),
		{ kind: 'stale' },
	);
});

test('a row whose project has gone is stale', () => {
	const inventory = { 'p-a': [entry({ sessionId: 's1' })] };
	const rows = buildDashboardRows(projects, inventory);

	assert.deepEqual(
		resolveDashboardActivation(rows[0], [projects[1]], inventory),
		{ kind: 'stale' },
	);
	assert.deepEqual(
		resolveDashboardActivation(rows[1], [projects[1]], inventory),
		{ kind: 'stale' },
	);
});

test('a file row activates its project rather than a terminal', () => {
	const inventory = {
		'p-a': [entry({ kind: 'file', panelId: 'f1', title: 'a.ts' })],
	};
	const rows = buildDashboardRows(projects, inventory);

	assert.deepEqual(resolveDashboardActivation(rows[1], projects, inventory), {
		kind: 'project',
		projectId: 'p-a',
	});
});
