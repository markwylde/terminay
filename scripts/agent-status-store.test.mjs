import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const {
	AgentStatusStore,
	createEmptyAgentStatusSnapshot,
	makeAgentStatusEntryId,
	reduceAgentStatusSnapshot,
	selectAgentStatusByAgentId,
	selectAgentStatusesByProvider,
	selectAgentStatusesByState,
	selectAgentStatusesForTerminal,
	selectRootAgentStatuses,
	selectRootAgentStatusForTerminal,
	selectSubagentStatuses,
	selectUnreadAgentStatuses,
} = await importStore();

const BASE = {
	provider: 'codex',
	sessionId: 'root-agent',
	activationTerminalSessionId: 'terminal-1',
};

function event(kind, sequence, occurredAt, details = {}) {
	return { ...BASE, kind, sequence, occurredAt, ...details };
}

test('root lifecycle is provider-neutral and same-state updates preserve stateStartedAt', () => {
	const store = new AgentStatusStore();

	assert.equal(store.dispatch(event('session.started', 1, 100)), true);
	let root = selectRootAgentStatuses(store.getSnapshot())[0];
	assert.equal(root.provider, 'codex');
	assert.equal(root.state, 'idle');
	assert.equal(root.stateStartedAt, 100);
	assert.equal(root.terminalSessionId, 'terminal-1');
	assert.equal(root.inProcess, false);

	store.dispatch(
		event('turn.started', 2, 200, {
			turnId: 'turn-1',
			promptText: 'Implement the sidebar',
			model: {
				id: 'gpt-5.3-codex',
				displayName: 'GPT-5.3 Codex',
				reasoningEffort: 'high',
			},
		}),
	);
	store.dispatch(
		event('tool.started', 3, 300, {
			tool: { id: 'tool-1', name: 'shell', description: 'Run tests' },
		}),
	);
	root = selectRootAgentStatuses(store.getSnapshot())[0];
	assert.equal(root.state, 'working');
	assert.equal(root.stateStartedAt, 200);
	assert.equal(root.promptText, 'Implement the sidebar');
	assert.equal(root.model?.id, 'gpt-5.3-codex');
	assert.equal(root.model?.reasoningEffort, 'high');
	assert.deepEqual(
		root.activeTools.map((tool) => tool.id),
		['tool-1'],
	);

	store.dispatch(
		event('tool.finished', 4, 400, { toolId: 'tool-1', outcome: 'success' }),
	);
	root = selectRootAgentStatuses(store.getSnapshot())[0];
	assert.equal(root.state, 'working');
	assert.equal(root.stateStartedAt, 200);
	assert.deepEqual(root.activeTools, []);
});

test('out-of-order sequence or timestamp is rejected without publishing', () => {
	const store = new AgentStatusStore();
	let notifications = 0;
	store.subscribe(() => {
		notifications += 1;
	});

	assert.equal(store.dispatch(event('turn.started', 10, 1_000)), true);
	const accepted = store.getSnapshot();
	assert.equal(store.dispatch(event('agent.done', 9, 1_100)), false);
	assert.equal(store.dispatch(event('agent.done', 10, 1_100)), false);
	assert.equal(store.dispatch(event('agent.done', 11, 999)), false);
	assert.equal(store.getSnapshot(), accepted);
	assert.equal(notifications, 1);
	assert.equal(
		selectRootAgentStatuses(store.getSnapshot())[0].state,
		'working',
	);
});

test('acknowledgement and unread are independent from operational state', () => {
	const store = new AgentStatusStore();
	store.dispatch(event('turn.started', 1, 100));
	store.dispatch(
		event('agent.done', 2, 200, { outcome: 'success', summary: 'Finished' }),
	);

	let root = selectRootAgentStatuses(store.getSnapshot())[0];
	assert.equal(root.state, 'done');
	assert.equal(root.unread, true);
	const stateStartedAt = root.stateStartedAt;

	assert.equal(store.markAcknowledged(root.entryId, 250), true);
	root = selectRootAgentStatuses(store.getSnapshot())[0];
	assert.equal(root.state, 'done');
	assert.equal(root.stateStartedAt, stateStartedAt);
	assert.equal(root.unread, false);
	assert.equal(root.acknowledgedAt, 250);

	store.dispatch(event('turn.started', 3, 300));
	root = selectRootAgentStatuses(store.getSnapshot())[0];
	assert.equal(root.state, 'working');
	assert.equal(root.unread, false);
});

test('wait lifecycle distinguishes waiting and blocked and remains unread until acknowledged', () => {
	const store = new AgentStatusStore();
	store.dispatch(event('turn.started', 1, 100));
	store.dispatch(
		event('wait.started', 2, 200, {
			state: 'waiting',
			reason: 'Waiting for provider',
		}),
	);
	let root = selectRootAgentStatuses(store.getSnapshot())[0];
	assert.equal(root.state, 'waiting');
	assert.equal(root.waitingReason, 'Waiting for provider');
	assert.equal(root.unread, true);

	store.dispatch(
		event('wait.started', 3, 300, {
			state: 'blocked',
			reason: 'Approval required',
		}),
	);
	root = selectRootAgentStatuses(store.getSnapshot())[0];
	assert.equal(root.state, 'blocked');
	assert.equal(root.stateStartedAt, 300);

	store.dispatch(event('wait.finished', 4, 400));
	root = selectRootAgentStatuses(store.getSnapshot())[0];
	assert.equal(root.state, 'working');
	assert.equal(root.unread, true);
	assert.equal(root.waitingReason, undefined);
});

test('in-process subagents retain their activation terminal and parent identity', () => {
	const store = new AgentStatusStore();
	store.dispatch(event('session.started', 1, 100));
	store.dispatch(
		event('subagent.started', 2, 200, {
			subagentId: 'researcher',
			displayName: 'Researcher',
		}),
	);
	store.dispatch(
		event('tool.started', 3, 300, {
			agentId: 'researcher',
			tool: { id: 'search', name: 'web-search' },
		}),
	);

	let child = selectSubagentStatuses(store.getSnapshot())[0];
	assert.equal(child.kind, 'subagent');
	assert.equal(child.inProcess, true);
	assert.equal(child.terminalSessionId, null);
	assert.equal(child.activationTerminalSessionId, 'terminal-1');
	assert.equal(child.parentAgentId, 'root-agent');
	assert.equal(
		child.parentEntryId,
		makeAgentStatusEntryId('terminal-1', 'root-agent', 'root-agent'),
	);
	assert.deepEqual(
		child.activeTools.map((tool) => tool.id),
		['search'],
	);

	store.dispatch(
		event('subagent.stopped', 4, 400, {
			subagentId: 'researcher',
			outcome: 'success',
		}),
	);
	child = selectSubagentStatuses(store.getSnapshot())[0];
	assert.equal(child.state, 'done');
	assert.equal(child.active, false);
	assert.equal(child.unread, true);
});

test('targeted subagent activity is rejected until the subagent is introduced', () => {
	const store = new AgentStatusStore();
	assert.equal(
		store.dispatch(
			event('tool.started', 2, 200, {
				agentId: 'not-started',
				tool: { id: 'search', name: 'web-search' },
			}),
		),
		false,
	);
	assert.equal(store.getSnapshot().revision, 0);
	assert.equal(selectRootAgentStatuses(store.getSnapshot()).length, 0);
});

test('done and exit lifecycle preserve completion while marking the agent inactive', () => {
	const store = new AgentStatusStore();
	store.dispatch(event('turn.started', 1, 100));
	store.dispatch(event('agent.done', 2, 200, { outcome: 'success' }));
	let root = selectRootAgentStatuses(store.getSnapshot())[0];
	assert.equal(root.state, 'done');
	assert.equal(root.active, true);
	assert.equal(root.completionOutcome, 'success');

	store.dispatch(
		event('agent.exited', 3, 300, { exitCode: 17, signal: 'SIGTERM' }),
	);
	root = selectRootAgentStatuses(store.getSnapshot())[0];
	assert.equal(root.state, 'done');
	assert.equal(root.stateStartedAt, 200);
	assert.equal(root.active, false);
	assert.equal(root.exitCode, 17);
	assert.equal(root.exitSignal, 'SIGTERM');
	assert.equal(root.completionOutcome, 'error');
});

test('provider sessions use independent ordering streams on the same terminal', () => {
	const first = event('turn.started', 50, 500);
	const second = {
		...event('session.started', 1, 100),
		provider: 'claude-code',
		sessionId: 'claude-root',
	};
	let snapshot = createEmptyAgentStatusSnapshot();
	snapshot = reduceAgentStatusSnapshot(snapshot, first);
	snapshot = reduceAgentStatusSnapshot(snapshot, second);

	assert.equal(snapshot.revision, 2);
	assert.equal(selectAgentStatusesByProvider(snapshot, 'codex').length, 1);
	assert.equal(
		selectAgentStatusesByProvider(snapshot, 'claude-code').length,
		1,
	);
	assert.equal(
		selectRootAgentStatusForTerminal(snapshot, 'terminal-1')?.sessionId,
		'root-agent',
	);
});

test('subscriptions receive immutable snapshots and selectors are deterministic', () => {
	const store = new AgentStatusStore();
	const revisions = [];
	const unsubscribe = store.subscribe((snapshot) =>
		revisions.push(snapshot.revision),
	);

	store.dispatch(event('turn.started', 1, 100));
	store.dispatch(
		event('subagent.started', 2, 200, {
			subagentId: 'z-child',
		}),
	);
	store.dispatch(
		event('subagent.started', 3, 300, {
			subagentId: 'a-child',
		}),
	);
	unsubscribe();
	store.dispatch(event('agent.done', 4, 400));

	const snapshot = store.getSnapshot();
	assert.deepEqual(revisions, [1, 2, 3]);
	assert.deepEqual(
		selectSubagentStatuses(snapshot).map((entry) => entry.agentId),
		['a-child', 'z-child'],
	);
	assert.equal(
		selectAgentStatusesForTerminal(snapshot, 'terminal-1').length,
		3,
	);
	assert.equal(selectAgentStatusesByState(snapshot, 'done').length, 1);
	assert.equal(selectUnreadAgentStatuses(snapshot).length, 1);
	assert.equal(
		selectAgentStatusByAgentId(snapshot, 'terminal-1', 'root-agent')?.agentId,
		'root-agent',
	);
});

test('markTerminalAcknowledged clears all unread entries without changing their states', () => {
	const store = new AgentStatusStore();
	const revisions = [];
	store.subscribe((snapshot) => revisions.push(snapshot.revision));
	store.dispatch(event('agent.done', 1, 100));
	store.dispatch(
		event('subagent.started', 2, 200, {
			subagentId: 'child',
		}),
	);
	store.dispatch(
		event('subagent.stopped', 3, 300, {
			subagentId: 'child',
			outcome: 'cancelled',
		}),
	);

	assert.equal(store.markTerminalAcknowledged('terminal-1', 400), 2);
	assert.deepEqual(revisions, [1, 2, 3, 4]);
	assert.equal(selectUnreadAgentStatuses(store.getSnapshot()).length, 0);
	assert.deepEqual(
		selectAgentStatusesForTerminal(store.getSnapshot(), 'terminal-1').map(
			(entry) => entry.state,
		),
		['done', 'done'],
	);
});

test('clear removes stale agent state while keeping snapshot revisions monotonic', () => {
	const store = new AgentStatusStore();
	const revisions = [];
	store.subscribe((snapshot) => revisions.push(snapshot.revision));
	store.dispatch(event('turn.started', 1, 100));

	assert.equal(store.clear(), true);
	assert.equal(store.getSnapshot().revision, 2);
	assert.deepEqual(store.getSnapshot().entries, {});
	assert.deepEqual(store.getSnapshot().eventCursors, {});
	assert.deepEqual(revisions, [1, 2]);
	assert.equal(store.clear(), false);
});

async function importStore() {
	const tempDir = await mkdtemp(
		join(tmpdir(), 'terminay-agent-status-store-test-'),
	);
	const outputPath = join(tempDir, 'store.mjs');
	await build({
		bundle: true,
		entryPoints: [
			new URL('../src/agentStatusStore.ts', import.meta.url).pathname,
		],
		format: 'esm',
		outfile: outputPath,
		platform: 'neutral',
		target: 'es2022',
	});
	return import(outputPath);
}
