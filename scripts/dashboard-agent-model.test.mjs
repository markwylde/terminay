import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildCrossServerDashboardGroups,
	flattenCrossServerDashboardGroups,
} from '../src/workspace/crossServerRows.ts';
import { filterDashboardGroups } from '../src/workspace/dashboardFilter.ts';
import {
	buildDashboardGroups,
	resolveAgentActivation,
	summarizeDashboard,
} from '../src/workspace/dashboardRows.ts';
import {
	boardColumnFor,
	buildDashboardBoardItems,
	groupBoardItemsByColumn,
	isDashboardViewMode,
} from '../src/workspace/dashboardViewMode.ts';

const projects = [
	{ color: '#336699', emoji: '🟩', id: 'p-a', title: 'Terminay' },
	{ color: '#993366', emoji: '🟦', id: 'p-b', title: 'Books' },
];

function panel(overrides = {}) {
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
		title: 'Terminal 1',
		...overrides,
	};
}

function agent(overrides = {}) {
	return {
		active: true,
		activationTerminalSessionId: 's1',
		activeTools: [],
		agentId: 'a-1',
		entryId: 'e-1',
		inProcess: false,
		kind: 'root',
		lastEventKind: 'turn.started',
		lastEventSequence: 1,
		provider: 'terminay/claude-code',
		providerDisplayName: 'Claude Code',
		sessionId: 'sess-1',
		state: 'working',
		stateStartedAt: 0,
		terminalSessionId: 's1',
		unread: false,
		updatedAt: 10,
		...overrides,
	};
}

function subagent(overrides = {}) {
	return {
		...agent(),
		agentId: 'a-2',
		entryId: 'e-2',
		inProcess: true,
		kind: 'subagent',
		parentAgentId: 'a-1',
		parentEntryId: 'e-1',
		terminalSessionId: null,
		...overrides,
	};
}

test('an agent joins the panel of the terminal it was started in', () => {
	const groups = buildDashboardGroups(
		projects,
		{
			'p-a': [
				panel({ panelId: 'panel-1', sessionId: 's1', status: 'working' }),
				panel({ panelId: 'panel-2', sessionId: 's2', title: 'zsh' }),
			],
		},
		{ 'p-a': [agent({ promptText: 'Isolate tenants' })] },
	);

	const [terminay] = groups;
	assert.deepEqual(
		terminay.panels.map((entry) => entry.agents.length),
		[1, 0],
	);
	assert.equal(terminay.panels[0].agents[0].name, 'Isolate tenants');
	assert.equal(terminay.detachedAgents.length, 0);
});

test('a generic terminal title never becomes the agent name, but a chosen one does', () => {
	const named = buildDashboardGroups(
		projects,
		{ 'p-a': [panel({ sessionId: 's1', title: 'Tenant work' })] },
		{ 'p-a': [agent({ promptText: 'Isolate tenants' })] },
	);
	assert.equal(named[0].panels[0].agents[0].name, 'Tenant work');

	const generic = buildDashboardGroups(
		projects,
		{ 'p-a': [panel({ sessionId: 's1', title: 'Terminal 1' })] },
		{ 'p-a': [agent({ promptText: 'Isolate tenants' })] },
	);
	assert.equal(generic[0].panels[0].agents[0].name, 'Isolate tenants');
});

test('subagents nest under their root and are counted, never listed at top level', () => {
	const groups = buildDashboardGroups(
		projects,
		{ 'p-a': [panel({ sessionId: 's1' })] },
		{
			'p-a': [
				agent(),
				subagent({ entryId: 'e-2', displayName: 'Search' }),
				subagent({ entryId: 'e-3', displayName: 'Verify' }),
				subagent({
					agentId: 'a-4',
					displayName: 'Deep',
					entryId: 'e-4',
					parentEntryId: 'e-2',
				}),
			],
		},
	);

	const roots = groups[0].panels[0].agents;
	assert.equal(roots.length, 1);
	assert.equal(roots[0].subagentCount, 3);
	assert.deepEqual(
		roots[0].subagents.map((child) => child.name),
		['Search', 'Verify'],
	);
	assert.deepEqual(
		roots[0].subagents[0].subagents.map((child) => child.name),
		['Deep'],
	);
});

test('a subagent whose root is gone is shown rather than dropped', () => {
	const groups = buildDashboardGroups(
		projects,
		{ 'p-a': [panel({ sessionId: 's1' })] },
		{ 'p-a': [subagent({ displayName: 'Orphan' })] },
	);

	assert.deepEqual(
		groups[0].panels[0].agents.map((entry) => entry.name),
		['Orphan'],
	);
});

test('agents come most urgent first', () => {
	const groups = buildDashboardGroups(
		projects,
		{ 'p-a': [panel({ sessionId: 's1' })] },
		{
			'p-a': [
				agent({ displayName: 'Done', entryId: 'e-1', state: 'done' }),
				agent({ displayName: 'Blocked', entryId: 'e-2', state: 'blocked' }),
				agent({ displayName: 'Working', entryId: 'e-3', state: 'working' }),
				agent({ displayName: 'Waiting', entryId: 'e-4', state: 'waiting' }),
			],
		},
	);

	assert.deepEqual(
		groups[0].panels[0].agents.map((entry) => entry.name),
		['Blocked', 'Waiting', 'Working', 'Done'],
	);
});

test('an agent whose panel this window does not hold is shown as detached', () => {
	const groups = buildDashboardGroups(
		projects,
		{},
		{ 'p-b': [agent({ displayName: 'Remote work', state: 'waiting' })] },
	);

	const books = groups[1];
	assert.equal(books.panels.length, 0);
	assert.deepEqual(
		books.detachedAgents.map((entry) => entry.name),
		['Remote work'],
	);
	// A detached agent is the only thing that project has, so it is what the
	// roll-up counts.
	assert.equal(books.project.counts.attention, 1);
});

test('a panel and the agent inside it are counted once, not twice', () => {
	const groups = buildDashboardGroups(
		projects,
		{ 'p-a': [panel({ isAgentStatus: true, sessionId: 's1', status: 'waiting' })] },
		{ 'p-a': [agent({ state: 'waiting' })] },
	);

	assert.deepEqual(groups[0].project.counts, {
		attention: 1,
		done: 0,
		panels: 1,
		working: 0,
	});
});

test('the summary adds up the roll-ups, idle included', () => {
	const groups = buildDashboardGroups(
		projects,
		{
			'p-a': [
				panel({ isAgentStatus: true, panelId: 'a', sessionId: 's1', status: 'waiting' }),
				panel({ panelId: 'b', sessionId: 's2', status: 'recent' }),
				panel({ kind: 'file', panelId: 'c', title: 'notes.md' }),
			],
			'p-b': [panel({ panelId: 'd', projectId: 'p-b', sessionId: 's4', status: 'unviewed' })],
		},
		{ 'p-b': [agent({ activationTerminalSessionId: 's9', state: 'blocked' })] },
	);

	assert.deepEqual(summarizeDashboard(groups), {
		attention: 2,
		done: 1,
		idle: 1,
		projects: 2,
		working: 1,
	});
});

test('every canonical state lands in exactly one board column', () => {
	assert.equal(boardColumnFor('blocked'), 'attention');
	assert.equal(boardColumnFor('waiting'), 'attention');
	assert.equal(boardColumnFor('working'), 'working');
	assert.equal(boardColumnFor('done'), 'done');
	assert.equal(boardColumnFor('idle'), 'idle');
});

test('the board takes one card per agent and one per agent-free panel', () => {
	const scoped = buildCrossServerDashboardGroups([
		{
			serverId: 'srv-1',
			serverLabel: 'Local',
			projects,
			inventoryByProject: {
				'p-a': [
					panel({ isAgentStatus: true, panelId: 'a', sessionId: 's1', status: 'waiting' }),
					panel({ kind: 'file', panelId: 'b', title: 'notes.md' }),
				],
			},
			agentsByProject: {
				'p-a': [
					agent({ displayName: 'First', entryId: 'e-1', state: 'waiting' }),
					agent({ displayName: 'Second', entryId: 'e-2', state: 'working' }),
					subagent({ displayName: 'Child', entryId: 'e-3' }),
				],
			},
		},
	]);

	const columns = groupBoardItemsByColumn(buildDashboardBoardItems(scoped));
	assert.deepEqual(
		columns.attention.map((item) => item.agent?.name),
		['First'],
	);
	assert.deepEqual(
		columns.working.map((item) => item.agent?.name),
		['Second'],
	);
	// The file panel owns no agent, so it is its own card; the subagent is
	// counted on its root rather than given one.
	assert.deepEqual(
		columns.idle.map((item) => item.panel?.title),
		['notes.md'],
	);
	assert.equal(columns.attention[0].project.title, 'Terminay');
});

test('a board card names the server that owns it when more than one is attached', () => {
	const scoped = buildCrossServerDashboardGroups([
		{
			serverId: 'srv-1',
			serverLabel: 'Local',
			projects: [projects[0]],
			inventoryByProject: { 'p-a': [panel({ sessionId: 's1' })] },
		},
		{
			serverId: 'srv-2',
			serverLabel: 'Studio',
			projects: [projects[0]],
			inventoryByProject: {},
			agentsByProject: { 'p-a': [agent({ activationTerminalSessionId: 's9' })] },
		},
	]);

	// Two servers, the same project id: nothing merges, and every key differs.
	assert.equal(scoped.length, 2);
	assert.equal(new Set(scoped.map((entry) => entry.key)).size, 2);
	const items = buildDashboardBoardItems(scoped);
	assert.deepEqual(
		items.map((item) => item.serverLabel),
		['Local', 'Studio'],
	);
});

test('the list view flattens the same groups the cards are built from', () => {
	const scoped = buildCrossServerDashboardGroups([
		{
			serverId: 'srv-1',
			serverLabel: 'Local',
			projects,
			inventoryByProject: {
				'p-a': [panel({ panelId: 'a', sessionId: 's1' })],
				'p-b': [panel({ panelId: 'b', projectId: 'p-b', sessionId: 's2' })],
			},
		},
	]);

	assert.deepEqual(
		flattenCrossServerDashboardGroups(scoped).map((entry) => [
			entry.row.kind,
			entry.row.kind === 'project' ? entry.row.title : entry.row.panelId,
		]),
		[
			['project', 'Terminay'],
			['panel', 'a'],
			['project', 'Books'],
			['panel', 'b'],
		],
	);
});

function filterFixture() {
	return buildCrossServerDashboardGroups([
		{
			serverId: 'srv-1',
			serverLabel: 'Local',
			projects,
			inventoryByProject: {
				'p-a': [
					panel({ isAgentStatus: true, panelId: 'a', sessionId: 's1' }),
					panel({ kind: 'file', panelId: 'b', title: 'notes.md' }),
				],
				'p-b': [panel({ panelId: 'c', projectId: 'p-b', sessionId: 's3', title: 'zsh' })],
			},
			agentsByProject: {
				'p-a': [
					agent({
						displayName: 'Tenant isolation',
						model: { id: 'grok-4.6', displayName: 'Grok 4.6' },
						promptText: 'Check the CSP headers',
					}),
				],
			},
		},
	]);
}

test('empty filter text is no filter at all', () => {
	const scoped = filterFixture();
	assert.equal(filterDashboardGroups(scoped, '   '), scoped);
});

test('the filter matches a project, a panel title, an agent name, a model, or a prompt', () => {
	const scoped = filterFixture();
	const names = (text) =>
		filterDashboardGroups(scoped, text).map((entry) => entry.row.project.title);

	assert.deepEqual(names('books'), ['Books']);
	assert.deepEqual(names('notes.md'), ['Terminay']);
	assert.deepEqual(names('tenant'), ['Terminay']);
	assert.deepEqual(names('grok'), ['Terminay']);
	assert.deepEqual(names('csp headers'), ['Terminay']);
	assert.deepEqual(names('nothing here'), []);
});

test('a filtered project keeps only what matched, and a named project keeps everything', () => {
	const scoped = filterFixture();

	const byAgent = filterDashboardGroups(scoped, 'tenant')[0].row;
	assert.deepEqual(
		byAgent.panels.map((entry) => entry.panelId),
		['a'],
	);

	const byProject = filterDashboardGroups(scoped, 'Terminay')[0].row;
	assert.deepEqual(
		byProject.panels.map((entry) => entry.panelId),
		['a', 'b'],
	);
});

test('a subagent match keeps its root', () => {
	const scoped = buildCrossServerDashboardGroups([
		{
			serverId: 'srv-1',
			serverLabel: 'Local',
			projects: [projects[0]],
			inventoryByProject: { 'p-a': [panel({ sessionId: 's1' })] },
			agentsByProject: {
				'p-a': [agent(), subagent({ displayName: 'Tenant sweep' })],
			},
		},
	]);

	const kept = filterDashboardGroups(scoped, 'tenant sweep');
	assert.equal(kept.length, 1);
	assert.deepEqual(
		kept[0].row.panels[0].agents.map((entry) => entry.name),
		['Claude Code'],
	);
});

test('activating an agent resolves to the panel it runs in', () => {
	const inventory = { 'p-a': [panel({ sessionId: 's1' })] };
	const groups = buildDashboardGroups(projects, inventory, {
		'p-a': [agent()],
	});
	const [running] = groups[0].panels[0].agents;

	assert.deepEqual(resolveAgentActivation(running, 'p-a', projects, inventory), {
		kind: 'panel',
		panelId: 'panel-1',
		projectId: 'p-a',
		sessionId: 's1',
	});
});

test('activating an agent whose panel has gone falls back to its project', () => {
	const inventory = { 'p-a': [panel({ sessionId: 's1' })] };
	const groups = buildDashboardGroups(projects, inventory, {
		'p-a': [agent()],
	});
	const [running] = groups[0].panels[0].agents;

	assert.deepEqual(
		resolveAgentActivation(running, 'p-a', projects, { 'p-a': [] }),
		{ kind: 'project', projectId: 'p-a' },
	);
	assert.deepEqual(
		resolveAgentActivation(running, 'p-a', [projects[1]], inventory),
		{ kind: 'stale' },
	);
});

test('only the three view modes are view modes', () => {
	assert.equal(isDashboardViewMode('list'), true);
	assert.equal(isDashboardViewMode('board'), true);
	assert.equal(isDashboardViewMode('projects'), true);
	assert.equal(isDashboardViewMode('kanban'), false);
	assert.equal(isDashboardViewMode(undefined), false);
});
