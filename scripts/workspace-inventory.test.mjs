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

test('the panel in front is marked whatever its kind, and only it', () => {
	const panels = [
		// A terminal keeps its own focus flag while a file is in front.
		{ id: 'p1', params: { sessionId: 's1', isFocused: true } },
		{ id: 'p2', params: { filePath: '/repo/server.ts' } },
		{ id: 'p3', params: { folderPath: '/repo/src' } },
	];
	const inFront = (activePanelId) =>
		buildProjectInventoryEntries({
			activePanelId,
			agentIntegrationEnabled: true,
			panels,
			project,
		})
			.filter((entry) => entry.isActivePanel === true)
			.map((entry) => entry.panelId);

	assert.deepEqual(inFront('p2'), ['p2']);
	assert.deepEqual(inFront('p3'), ['p3']);
	assert.deepEqual(inFront('p1'), ['p1']);
	assert.deepEqual(inFront(undefined), []);
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
		{
			id: 'p1',
			params: {
				agentState: 'working',
				sessionId: 's1',
				showActiveTabActivityIndicator: true,
			},
		},
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
	// An untracked terminal reads idle everywhere.
	assert.equal(entries[5].status, 'idle');
	assert.equal(entries[5].untracked, true);
});

test('an untracked terminal is idle whatever it or its agent is doing', () => {
	const untracked = (id, params) => ({
		id,
		params: { activityIndicatorsEnabled: false, sessionId: id, ...params },
	});
	const entries = build([
		untracked('s1', {
			terminalActivitySince: 10,
			terminalActivityState: 'recent',
		}),
		untracked('s2', { terminalActivityState: 'attention' }),
		untracked('s3', {
			agentState: 'working',
			agentStateSince: 10,
		}),
		untracked('s4', { agentState: 'done', agentUnread: true }),
		untracked('s5', { agentState: 'blocked' }),
		{ id: 's6', params: { sessionId: 's6', terminalActivityState: 'attention' } },
	]);

	for (const entry of entries.slice(0, 5)) {
		assert.equal(entry.status, 'idle', entry.panelId);
		assert.equal(entry.untracked, true, entry.panelId);
		assert.equal(entry.indicatorsSuppressed, true, entry.panelId);
		assert.equal(entry.since, undefined, entry.panelId);
		assert.equal(entry.agentUnread, undefined, entry.panelId);
		assert.equal(isNotableInventoryEntry(entry), false, entry.panelId);
	}
	// The agent is still known to be there, so its detail can be shown.
	assert.deepEqual(
		entries.map((entry) => entry.isAgentStatus),
		[false, false, true, true, true, false],
	);
	assert.equal(entries[5].untracked, undefined);
	assert.deepEqual(
		selectNotableEntries(entries).map((item) => item.panelId),
		['s6'],
	);
});

test('agent entries honour the same indicator settings as raw output', () => {
	const entries = build([
		// working needs the active-tab indicator opted in
		{ id: 'p1', params: { agentState: 'working', sessionId: 's1' } },
		{
			id: 'p2',
			params: {
				agentState: 'working',
				sessionId: 's2',
				showActiveTabActivityIndicator: true,
			},
		},
		// done is visible unless the finished indicator is opted out
		{
			id: 'p3',
			params: { agentState: 'done', agentUnread: true, sessionId: 's3' },
		},
		{
			id: 'p4',
			params: {
				agentState: 'done',
				agentUnread: true,
				sessionId: 's4',
				showFinishedTabActivityIndicator: false,
			},
		},
		// indicators off entirely hides even attention
		{
			id: 'p5',
			params: {
				activityIndicatorsEnabled: false,
				agentState: 'waiting',
				sessionId: 's5',
			},
		},
		{ id: 'p6', params: { agentState: 'blocked', sessionId: 's6' } },
	]);

	assert.deepEqual(
		selectNotableEntries(entries).map((item) => item.panelId),
		['p2', 'p3', 'p6'],
	);
	// Suppressing an indicator hides the badge, never the canonical status.
	assert.equal(entries[3].status, 'done');
	assert.equal(entries[3].indicatorsSuppressed, true);
	// An untracked terminal is idle, its agent's state included.
	assert.equal(entries[4].status, 'idle');
	assert.equal(entries[4].untracked, true);
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
