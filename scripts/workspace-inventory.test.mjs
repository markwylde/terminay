import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildProjectInventoryEntries,
	isNotableInventoryEntry,
	selectNotableEntries,
} from '../src/workspace/workspaceInventory.ts';

const project = {
	color: '#336699',
	emoji: '🟩',
	id: 'project-a',
	title: 'Terminay',
};

function build(panels, agentIntegrationEnabled = true) {
	return buildProjectInventoryEntries({
		agentIntegrationEnabled,
		panels,
		project,
	});
}

test('every panel is inventoried with its kind, including idle ones', () => {
	const entries = build([
		{ id: 'p1', title: 'zsh', params: { sessionId: 's1' } },
		{
			id: 'p2',
			title: 'server.ts',
			params: { filePath: '/repo/server.ts' },
		},
		{ id: 'p3', title: 'src', params: { folderPath: '/repo/src' } },
	]);

	assert.deepEqual(
		entries.map((entry) => [entry.panelId, entry.kind, entry.status]),
		[
			['p1', 'terminal', 'idle'],
			['p2', 'file', 'idle'],
			['p3', 'folder', 'idle'],
		],
	);
	assert.equal(entries[0].sessionId, 's1');
	assert.equal(entries[1].sessionId, undefined);
	// Nothing notable is happening, so the notable-only surfaces stay empty.
	assert.deepEqual(selectNotableEntries(entries), []);
});

test('panel order is preserved as given', () => {
	const entries = build([
		{ id: 'p3', params: { sessionId: 's3' } },
		{ id: 'p1', params: { sessionId: 's1' } },
		{ id: 'p2', params: { sessionId: 's2' } },
	]);

	assert.deepEqual(
		entries.map((entry) => entry.panelId),
		['p3', 'p1', 'p2'],
	);
});

test('a panel with no title falls back to a name for its kind', () => {
	const entries = build([
		{ id: 'p1', params: { sessionId: 's1' } },
		{ id: 'p2', params: { filePath: '/repo/a.ts' } },
		{ id: 'p3', params: { folderPath: '/repo' } },
	]);

	assert.deepEqual(
		entries.map((entry) => entry.title),
		['Terminal', 'File', 'Folder'],
	);
});

test('agent authority wins and raw output never competes with it', () => {
	const entries = build([
		{
			id: 'p1',
			title: 'Claude Code',
			params: {
				agentState: 'working',
				sessionId: 's1',
				// Raw output says something else; the agent state is authoritative.
				terminalActivityState: 'unviewed',
			},
		},
	]);

	assert.equal(entries[0].status, 'working');
	assert.equal(entries[0].isAgentStatus, true);
});

test('agent state is ignored when agent integration is disabled', () => {
	const entries = build(
		[
			{
				id: 'p1',
				params: {
					agentState: 'working',
					sessionId: 's1',
					showFinishedTabActivityIndicator: true,
					terminalActivityState: 'unviewed',
				},
			},
		],
		false,
	);

	assert.equal(entries[0].isAgentStatus, false);
	assert.equal(entries[0].status, 'unviewed');
});

test('an idle agent-owned terminal is inventoried but not notable', () => {
	const entries = build([
		{ id: 'p1', params: { agentState: 'idle', sessionId: 's1' } },
	]);

	assert.equal(entries[0].status, 'idle');
	assert.equal(isNotableInventoryEntry(entries[0]), false);
});

test('notable agent entries are working, attention, and unread done', () => {
	const entries = build([
		{ id: 'p1', params: { agentState: 'working', sessionId: 's1' } },
		{ id: 'p2', params: { agentState: 'waiting', sessionId: 's2' } },
		{ id: 'p3', params: { agentState: 'blocked', sessionId: 's3' } },
		{
			id: 'p4',
			params: { agentState: 'done', agentUnread: true, sessionId: 's4' },
		},
		{ id: 'p5', params: { agentState: 'done', sessionId: 's5' } },
	]);

	assert.deepEqual(
		selectNotableEntries(entries).map((item) => [item.panelId, item.state]),
		[
			['p1', 'working'],
			['p2', 'waiting'],
			['p3', 'blocked'],
			['p4', 'done'],
		],
	);
	// A read "done" agent still shows its state on the dashboard.
	assert.equal(entries[4].status, 'done');
});

test('raw-output entries honour their own indicator settings', () => {
	const entries = build([
		// attention is always visible
		{
			id: 'p1',
			params: { sessionId: 's1', terminalActivityState: 'attention' },
		},
		// recent needs the active-tab indicator opted in
		{ id: 'p2', params: { sessionId: 's2', terminalActivityState: 'recent' } },
		{
			id: 'p3',
			params: {
				sessionId: 's3',
				showActiveTabActivityIndicator: true,
				terminalActivityState: 'recent',
			},
		},
		// unviewed is visible unless the finished indicator is opted out
		{
			id: 'p4',
			params: { sessionId: 's4', terminalActivityState: 'unviewed' },
		},
		{
			id: 'p5',
			params: {
				sessionId: 's5',
				showFinishedTabActivityIndicator: false,
				terminalActivityState: 'unviewed',
			},
		},
		// indicators off entirely
		{
			id: 'p6',
			params: {
				activityIndicatorsEnabled: false,
				sessionId: 's6',
				terminalActivityState: 'attention',
			},
		},
	]);

	assert.deepEqual(
		selectNotableEntries(entries).map((item) => item.panelId),
		['p1', 'p3', 'p4'],
	);
	// Suppressing an indicator hides the badge, never the canonical status.
	assert.equal(entries[4].status, 'unviewed');
	assert.equal(entries[5].status, 'attention');
});

test('a viewed terminal rests at idle', () => {
	const entries = build([
		{ id: 'p1', params: { sessionId: 's1', terminalActivityState: 'viewed' } },
	]);

	assert.equal(entries[0].status, 'idle');
	assert.deepEqual(selectNotableEntries(entries), []);
});

test('file and folder panels are never notable', () => {
	const entries = build([
		{ id: 'p1', params: { filePath: '/repo/a.ts' } },
		{ id: 'p2', params: { folderPath: '/repo' } },
	]);

	assert.deepEqual(entries.map(isNotableInventoryEntry), [false, false]);
});

test('panel colour follows the tab appearance rules', () => {
	const entries = build([
		{ id: 'p1', params: { sessionId: 's1' } },
		{ id: 'p2', params: { color: '#ff0000', sessionId: 's2' } },
		{
			id: 'p3',
			params: {
				inheritsProjectColor: true,
				color: '#ff0000',
				projectColor: '#00ff00',
				sessionId: 's3',
			},
		},
	]);

	assert.deepEqual(
		entries.map((entry) => entry.color),
		['#336699', '#ff0000', '#00ff00'],
	);
});
