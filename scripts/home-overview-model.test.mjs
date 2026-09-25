import assert from 'node:assert/strict';
import test from 'node:test';
import {
	agentGroupFor,
	buildHomeOverview,
} from '../src/workspace/homeOverviewModel.ts';

/**
 * The Home overview counts what the rest of the workspace already shows. These
 * fixtures are the same shapes the dashboard reads, so a count here and a row
 * there are built from one set of facts.
 */

function project(id, title = id) {
	return { color: '#336699', emoji: '', id, title };
}

function panel(projectId, panelId, overrides = {}) {
	return {
		color: '#336699',
		emoji: '',
		isAgentStatus: false,
		kind: 'terminal',
		panelId,
		projectEmoji: '',
		projectId,
		projectTitle: projectId,
		status: 'idle',
		title: panelId,
		...overrides,
	};
}

function agent(entryId, state, overrides = {}) {
	return {
		active: true,
		activationTerminalSessionId: null,
		activeTools: [],
		agentId: entryId,
		entryId,
		inProcess: false,
		kind: 'root',
		lastEventKind: 'turn.started',
		lastEventSequence: 1,
		provider: 'terminay/claude-code',
		providerDisplayName: 'Claude Code',
		sessionId: `sess-${entryId}`,
		state,
		stateStartedAt: 0,
		terminalSessionId: null,
		unread: false,
		updatedAt: 10,
		...overrides,
	};
}

function source(overrides = {}) {
	return {
		serverId: 'server-a',
		serverLabel: 'Local',
		available: true,
		hasInventory: true,
		projects: [],
		inventoryByProject: {},
		agentsByProject: {},
		...overrides,
	};
}

test('counts reflect the workspace: projects, tabs, terminals, and agents', () => {
	const overview = buildHomeOverview({
		sources: [
			source({
				projects: [project('p-a'), project('p-b'), project('p-c')],
				inventoryByProject: {
					'p-a': [
						panel('p-a', 't1', { sessionId: 's1' }),
						panel('p-a', 't2', { sessionId: 's2' }),
						panel('p-a', 'f1', { kind: 'file' }),
					],
					'p-b': [
						panel('p-b', 't3', { sessionId: 's3' }),
						panel('p-b', 'd1', { kind: 'folder' }),
					],
					'p-c': [
						panel('p-c', 't4', { sessionId: 's4' }),
						panel('p-c', 't5', { sessionId: 's5' }),
					],
				},
				agentsByProject: {
					'p-a': [
						agent('e1', 'waiting', { activationTerminalSessionId: 's1' }),
						agent('e2', 'blocked', { activationTerminalSessionId: 's2' }),
					],
					'p-b': [
						agent('e3', 'working', { activationTerminalSessionId: 's3' }),
					],
				},
			}),
		],
	});

	assert.equal(overview.projects.value, 3);
	assert.equal(overview.tabs.value, 7);
	assert.equal(overview.terminals.value, 5);
	assert.equal(overview.agents.needsYou, 2);
	assert.equal(overview.agents.working, 1);
	assert.equal(overview.agents.done, 0);
	assert.equal(overview.agents.idle, 0);
	assert.equal(overview.agents.total, 3);
	assert.deepEqual(overview.tabs.unavailable, []);
	assert.deepEqual(overview.agents.unavailable, []);
});

test('agents are counted by canonical state group, roots only, never external', () => {
	assert.equal(agentGroupFor('waiting'), 'needsYou');
	assert.equal(agentGroupFor('blocked'), 'needsYou');
	assert.equal(agentGroupFor('working'), 'working');
	assert.equal(agentGroupFor('done'), 'done');
	assert.equal(agentGroupFor('idle'), 'idle');

	const overview = buildHomeOverview({
		sources: [
			source({
				projects: [project('p-a')],
				agentsByProject: {
					'p-a': [
						agent('root', 'working'),
						// A subagent is counted on its root, as the dashboard does.
						agent('child', 'waiting', {
							kind: 'subagent',
							parentEntryId: 'root',
						}),
						agent('done', 'done'),
						agent('idle', 'idle'),
						agent('outside', 'waiting', { external: true }),
					],
				},
			}),
		],
	});
	assert.equal(overview.agents.working, 1);
	assert.equal(overview.agents.needsYou, 0);
	assert.equal(overview.agents.done, 1);
	assert.equal(overview.agents.idle, 1);
	assert.equal(overview.agents.total, 3);
});

test('an empty workspace: one empty project, no tabs, no agents, no automations', () => {
	const overview = buildHomeOverview({
		sources: [source({ projects: [project('p-a')] })],
	});
	assert.equal(overview.projects.value, 1);
	assert.equal(overview.tabs.value, 0);
	assert.equal(overview.terminals.value, 0);
	assert.equal(overview.agents.total, 0);
	assert.equal(overview.automations.isEmpty, true);
	assert.equal(overview.automations.total, 0);
	assert.deepEqual(overview.automations.active, []);
	assert.deepEqual(overview.automations.recentRuns, []);
	assert.equal(overview.automations.nextRun, undefined);

	// Supplied but empty reads the same as not yet supplied.
	const supplied = buildHomeOverview({
		sources: [source({ projects: [project('p-a')] })],
		automationSources: [
			{
				serverId: 'server-a',
				serverLabel: 'Local',
				available: true,
				automations: [],
				runs: [],
			},
		],
	});
	assert.equal(supplied.automations.isEmpty, true);
});

test('an offline connection is marked unavailable rather than counted as zero', () => {
	const overview = buildHomeOverview({
		sources: [
			source({
				projects: [project('p-a')],
				inventoryByProject: { 'p-a': [panel('p-a', 't1')] },
				agentsByProject: { 'p-a': [agent('e1', 'working')] },
			}),
			source({
				serverId: 'server-b',
				serverLabel: 'Build box',
				available: false,
				hasInventory: false,
				projects: [project('p-x'), project('p-y')],
				agentsByProject: { 'p-x': [agent('e9', 'waiting')] },
			}),
		],
		automationSources: [
			{
				serverId: 'server-b',
				serverLabel: 'Build box',
				available: false,
				automations: [],
				runs: [],
			},
		],
	});

	const offline = [
		{ serverId: 'server-b', serverLabel: 'Build box', reason: 'offline' },
	];
	// Only the connection that could answer is counted.
	assert.equal(overview.projects.value, 1);
	assert.equal(overview.tabs.value, 1);
	assert.equal(overview.agents.working, 1);
	assert.equal(overview.agents.needsYou, 0);
	// And the one that could not is named, not zeroed.
	assert.deepEqual(overview.projects.unavailable, offline);
	assert.deepEqual(overview.tabs.unavailable, offline);
	assert.deepEqual(overview.agents.unavailable, offline);
	assert.deepEqual(overview.connections.unavailable, offline);
	assert.equal(overview.connections.attached, 2);
	assert.equal(overview.connections.available, 1);
	assert.deepEqual(overview.automations.unavailable, offline);
	assert.equal(overview.automations.isEmpty, false);
});

test('a usable server whose panels this window does not hold counts its projects and agents, not its tabs', () => {
	const overview = buildHomeOverview({
		sources: [
			source({
				projects: [project('p-a')],
				inventoryByProject: { 'p-a': [panel('p-a', 't1')] },
			}),
			source({
				serverId: 'server-b',
				serverLabel: 'Build box',
				hasInventory: false,
				projects: [project('p-x')],
				agentsByProject: { 'p-x': [agent('e9', 'waiting')] },
			}),
		],
	});
	assert.equal(overview.projects.value, 2);
	assert.deepEqual(overview.projects.unavailable, []);
	assert.equal(overview.agents.needsYou, 1);
	assert.equal(overview.tabs.value, 1);
	assert.deepEqual(overview.tabs.unavailable, [
		{ serverId: 'server-b', serverLabel: 'Build box', reason: 'not-held' },
	]);
});

test('remote devices: unknown, off, and on with each device counted once', () => {
	assert.deepEqual(
		buildHomeOverview({ sources: [source()] }).connections.devices,
		{ state: 'unknown' },
	);
	assert.deepEqual(
		buildHomeOverview({
			sources: [source()],
			remoteAccess: { isRunning: false, connections: [], pairedDeviceCount: 2 },
		}).connections.devices,
		{ state: 'off', paired: 2 },
	);
	assert.deepEqual(
		buildHomeOverview({
			sources: [source()],
			remoteAccess: {
				isRunning: true,
				connections: [
					{ deviceId: 'phone' },
					{ deviceId: 'phone' },
					{ deviceId: 'tablet' },
				],
				pairedDeviceCount: 3,
			},
		}).connections.devices,
		{ state: 'on', connected: 2, paired: 3 },
	);
});

test('active automations sort by next run, and recent runs newest first, naming servers when several are attached', () => {
	const overview = buildHomeOverview({
		sources: [
			source(),
			source({ serverId: 'server-b', serverLabel: 'Build box' }),
		],
		recentRunLimit: 2,
		automationSources: [
			{
				serverId: 'server-a',
				serverLabel: 'Local',
				available: true,
				automations: [
					{
						automationId: 'a1',
						name: 'Hourly sweep',
						enabled: true,
						nextRunAt: 3_000,
					},
					{ automationId: 'a2', name: 'Page me', enabled: true },
					{
						automationId: 'a3',
						name: 'Paused',
						enabled: false,
						nextRunAt: 500,
					},
				],
				runs: [
					{
						runId: 'r1',
						automationId: 'a1',
						automationName: 'Hourly sweep',
						startedAt: 100,
						outcome: 'success',
					},
					{
						runId: 'r2',
						automationId: 'a2',
						automationName: 'Page me',
						startedAt: 300,
						outcome: 'failure',
					},
				],
			},
			{
				serverId: 'server-b',
				serverLabel: 'Build box',
				available: true,
				automations: [
					{
						automationId: 'b1',
						name: 'Nightly',
						enabled: true,
						nextRunAt: 2_000,
					},
				],
				runs: [
					{
						runId: 'r3',
						automationId: 'b1',
						automationName: 'Nightly',
						startedAt: 200,
						outcome: 'running',
					},
				],
			},
		],
	});

	const { automations } = overview;
	assert.equal(automations.total, 4);
	assert.equal(automations.isEmpty, false);
	assert.deepEqual(
		automations.active.map((item) => [item.automationId, item.serverLabel]),
		[
			['b1', 'Build box'],
			['a1', 'Local'],
			['a2', 'Local'],
		],
	);
	assert.equal(automations.nextRun?.automationId, 'b1');
	assert.equal(automations.nextRun?.nextRunAt, 2_000);
	assert.deepEqual(
		automations.recentRuns.map((run) => [
			run.runId,
			run.serverLabel,
			run.outcome,
		]),
		[
			['r2', 'Local', 'failure'],
			['r3', 'Build box', 'running'],
		],
	);
});

test('with one server attached, automation rows do not repeat its name', () => {
	const overview = buildHomeOverview({
		sources: [source()],
		automationSources: [
			{
				serverId: 'server-a',
				serverLabel: 'Local',
				available: true,
				automations: [{ automationId: 'a1', name: 'Page me', enabled: true }],
				runs: [],
			},
		],
	});
	assert.equal(overview.automations.active[0]?.serverLabel, undefined);
	assert.equal(overview.automations.nextRun, undefined);
});
