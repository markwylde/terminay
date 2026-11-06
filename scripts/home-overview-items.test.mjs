import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHomeOverview } from '../src/workspace/homeOverviewModel.ts';

/**
 * The Home overview's listed items: Needs you, workflows, pull requests, bots,
 * bot sessions, and the run history. Fixtures are the shapes the window holds.
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

function step(id, status, overrides = {}) {
	return {
		id,
		title: id,
		prompt: '',
		icon: 'code',
		status,
		note: '',
		startedAt: null,
		endedAt: null,
		...overrides,
	};
}

function workflow(sessionId, steps, overrides = {}) {
	return {
		sessionId,
		state: 'attached',
		resumeStepId: null,
		unfinished: true,
		workflow: {
			id: `wf-${sessionId}`,
			name: `Workflow ${sessionId}`,
			openingPrompt: '',
			templateId: null,
			createdAt: 0,
			steps,
		},
		...overrides,
	};
}

function bot(id, overrides = {}) {
	return {
		serverId: 'server-a',
		serverLabel: 'Local',
		bot: { id, name: id, colour: '#7cc4ff', avatar: '' },
		sessions: [],
		environment: 'running',
		...overrides,
	};
}

function session(id, state, startedAt, overrides = {}) {
	return {
		id,
		botId: 'b',
		origin: { kind: 'chat' },
		state,
		startedAt,
		endedAt: null,
		permission: null,
		permissions: [],
		queuedMessage: null,
		...overrides,
	};
}

const terminals = {
	'p-a': [
		panel('p-a', 't1', { sessionId: 's1', folderId: 'f1' }),
		panel('p-a', 't2', { sessionId: 's2', folderId: 'f1' }),
		panel('p-a', 't3', { sessionId: 's3', folderId: 'f2' }),
		panel('p-a', 't4', { sessionId: 's4', folderId: 'f3' }),
	],
};

test('Needs you lists agents, bot sessions, and workflow inputs oldest first, then failures', () => {
	const overview = buildHomeOverview({
		sources: [
			source({
				projects: [project('p-a')],
				inventoryByProject: terminals,
				agentsByProject: {
					'p-a': [
						agent('waiting', 'waiting', {
							activationTerminalSessionId: 's1',
							stateStartedAt: 300,
						}),
						agent('working', 'working', { activationTerminalSessionId: 's2' }),
					],
				},
			}),
		],
		bots: [
			bot('b', {
				sessions: [
					session('ask', 'running', 200, {
						permission: { toolCall: { title: 'git push' } },
					}),
					session('done', 'completed', 50),
				],
			}),
		],
		workflowsByServer: new Map([
			[
				'server-a',
				[
					workflow('s3', [step('review', 'needs_input', { startedAt: 100 })]),
					workflow('s4', [
						step('build', 'failed', { startedAt: 10, endedAt: 20 }),
					]),
				],
			],
		]),
		now: 1_000,
	});
	const items = overview.attention.items;
	assert.deepEqual(
		items.map((item) => item.kind),
		['workflow', 'bot', 'agent', 'workflow'],
	);
	assert.equal(items[1].summary, 'Wants to run: git push');
	assert.equal(items[3].workflow.sessionId, 's4');
});

test('workflows rank alert, running, other unfinished, then finished newest first', () => {
	const overview = buildHomeOverview({
		sources: [
			source({ projects: [project('p-a')], inventoryByProject: terminals }),
		],
		workflowsByServer: new Map([
			[
				'server-a',
				[
					workflow('s1', [
						step('a', 'done', { endedAt: 5 }),
						step('b', 'done', { endedAt: 50 }),
					]),
					workflow('s2', [
						step('a', 'done'),
						step('b', 'running', { startedAt: 400 }),
						step('c', 'not_started'),
					]),
					workflow('s3', [step('a', 'not_started')]),
					workflow('s4', [
						step('a', 'failed', { endedAt: 9 }),
						step('b', 'not_started'),
					]),
					workflow('gone', [step('a', 'running')]),
				],
			],
		]),
		now: 1_000,
	});
	const items = overview.workflows.items;
	assert.deepEqual(
		items.map((item) => [item.sessionId, item.rank]),
		[
			['s4', 'alert'],
			['s2', 'running'],
			['s3', 'unfinished'],
			['s1', 'finished'],
		],
	);
	const running = items[1];
	assert.deepEqual(running.current, { title: 'b', status: 'running' });
	assert.equal(running.currentStartedAt, 400);
	assert.equal(running.summary.done, 1);
	assert.equal(running.summary.total, 3);
	// A failed step is the current step when nothing is active, and has no time.
	assert.deepEqual(items[0].current, { title: 'a', status: 'failed' });
	assert.equal(items[0].currentStartedAt, undefined);
	// Otherwise the first step not done.
	assert.deepEqual(items[2].current, { title: 'a', status: 'not_started' });
	assert.equal(items[3].finishedAt, 50);
});

test('an unrestorable workflow is listed as an alert', () => {
	const overview = buildHomeOverview({
		sources: [
			source({ projects: [project('p-a')], inventoryByProject: terminals }),
		],
		workflowsByServer: new Map([
			['server-a', [{ sessionId: 's1', state: 'unrestorable' }]],
		]),
	});
	assert.equal(overview.workflows.items[0].rank, 'alert');
	assert.equal(
		overview.workflows.items[0].summary.label,
		'Workflow could not be restored',
	);
});

test('pull requests: one row per folder, open and draft only, failing first', () => {
	const facts = (state, checks) => ({
		pullRequest: { number: 7, title: `PR ${state}`, state },
		...(checks === undefined ? {} : { checks }),
	});
	const overview = buildHomeOverview({
		sources: [
			source({
				projects: [project('p-a')],
				inventoryByProject: {
					'p-a': [
						panel('p-a', 'a1', {
							folderId: 'f1',
							worktree: facts('open', {
								failed: 0,
								passed: 3,
								pending: 0,
								skipped: 0,
								total: 3,
							}),
						}),
						panel('p-a', 'a2', { folderId: 'f1', worktree: facts('open') }),
						panel('p-a', 'b1', { folderId: 'f2', worktree: facts('draft') }),
						panel('p-a', 'c1', { folderId: 'f3', worktree: facts('merged') }),
						panel('p-a', 'd1', {
							folderId: 'f4',
							worktree: facts('open', {
								failed: 1,
								passed: 3,
								pending: 0,
								skipped: 0,
								total: 4,
							}),
						}),
					],
				},
			}),
		],
	});
	const items = overview.pullRequests.items;
	assert.deepEqual(
		items.map((item) => item.panelId),
		['d1', 'a1', 'b1'],
	);
	assert.equal(items[2].draft, true);
	assert.equal(items[2].checks, undefined, 'no check data reads as No checks');
});

test('workflows and pull requests name servers whose panels are not held', () => {
	const overview = buildHomeOverview({
		sources: [
			source({ projects: [project('p-a')], inventoryByProject: terminals }),
			source({
				serverId: 'server-b',
				serverLabel: 'Remote',
				hasInventory: false,
			}),
		],
		workflowsByServer: new Map([
			['server-a', [workflow('s1', [step('a', 'running')])]],
			['server-b', [workflow('s1', [step('a', 'running')])]],
		]),
	});
	assert.equal(overview.workflows.items.length, 1);
	assert.equal(overview.workflows.items[0].serverLabel, 'Local');
	assert.deepEqual(
		overview.workflows.unavailable.map((item) => [
			item.serverLabel,
			item.reason,
		]),
		[['Remote', 'not-held']],
	);
	assert.deepEqual(
		overview.pullRequests.unavailable,
		overview.workflows.unavailable,
	);
});

test('equal bot ids on two servers stay two bots, each named with its server', () => {
	const overview = buildHomeOverview({
		sources: [
			source(),
			source({ serverId: 'server-b', serverLabel: 'Remote' }),
		],
		bots: [
			bot('same'),
			bot('same', { serverId: 'server-b', serverLabel: 'Remote' }),
		],
	});
	const keys = overview.bots.items.map((item) => item.key);
	assert.equal(new Set(keys).size, 2);
	assert.deepEqual(overview.bots.items.map((item) => item.serverLabel).sort(), [
		'Local',
		'Remote',
	]);
});

test('bots lead with those that need the user and expose the soonest trigger', () => {
	const overview = buildHomeOverview({
		sources: [source()],
		bots: [
			bot('idle', { nextTrigger: { name: 'Nightly', at: 500 } }),
			bot('asking', {
				sessions: [session('x', 'needs-you', 1)],
				nextTrigger: { name: 'Hourly', at: 100 },
			}),
		],
	});
	assert.equal(overview.bots.items[0].bot.id, 'asking');
	assert.equal(overview.bots.items[0].needsYou, 1);
	assert.equal(overview.bots.nextTrigger?.nextTrigger.name, 'Hourly');
});

test('bot sessions are listed newest first across bots', () => {
	const overview = buildHomeOverview({
		sources: [source()],
		bots: [
			bot('one', {
				sessions: [session('a', 'completed', 10), session('b', 'failed', 30)],
			}),
			bot('two', { sessions: [session('c', 'running', 20)] }),
		],
	});
	assert.deepEqual(
		overview.botSessions.map((item) => item.sessionId),
		['b', 'c', 'a'],
	);
});

test('run success rate counts succeeded over succeeded, failed, and timed out', () => {
	const outcomes = [
		...Array(26).fill('success'),
		'failure',
		'timed-out',
		'skipped',
		'running',
		'success',
	];
	const overview = buildHomeOverview({
		sources: [source()],
		automationSources: [
			{
				serverId: 'server-a',
				serverLabel: 'Local',
				available: true,
				automations: [],
				runs: outcomes.map((outcome, index) => ({
					runId: `r${index}`,
					automationId: 'a',
					automationName: 'Hourly',
					startedAt: 1_000 - index,
					outcome,
				})),
			},
		],
	});
	const history = overview.automations.history;
	assert.equal(history.runs.length, 30, 'only the last thirty runs');
	assert.equal(history.succeeded, 26);
	assert.equal(history.failed, 2);
	assert.equal(history.skipped, 1);
	assert.equal(history.running, 1);
	assert.equal(Math.round((history.successRate ?? 0) * 100), 93);
});

test('no finished runs, no rate', () => {
	const overview = buildHomeOverview({ sources: [source()] });
	assert.equal(overview.automations.history.successRate, undefined);
});

test('project items carry their counts and tab totals', () => {
	const overview = buildHomeOverview({
		sources: [
			source({
				projects: [project('p-a', 'Alpha')],
				inventoryByProject: terminals,
			}),
		],
	});
	assert.equal(overview.projectItems[0].title, 'Alpha');
	assert.equal(overview.projectItems[0].tabs, 4);
	assert.equal(overview.projectItems[0].terminals, 4);
});
