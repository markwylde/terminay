import assert from 'node:assert/strict';
import test from 'node:test';
import {
	AgentStatusStore,
	agentIdSegment,
	makeAgentStatusEntryId,
} from '../dist/index.js';

const entry = (overrides = {}) => ({
	entryId: 'e1',
	kind: 'root',
	provider: 'com.example/agents',
	harness: 'claude-code',
	agentId: 's1',
	sessionId: 's1',
	activationTerminalSessionId: 'terminal-1',
	external: false,
	projectIds: ['p'],
	state: 'done',
	stateStartedAt: 1,
	createdAt: 1,
	updatedAt: 1,
	active: true,
	activeTools: [],
	unread: true,
	terminalSessionId: 'terminal-1',
	inProcess: false,
	openSubagents: 0,
	...overrides,
});

test('entry ids are wire-safe whatever the source id says', () => {
	assert.equal(agentIdSegment('abc-1.2_3'), 'abc-1.2_3');
	assert.equal(agentIdSegment('a/b c'), 'a%2Fb%20c');
	assert.equal(agentIdSegment('-lead'), 's-lead');
	assert.match(
		makeAgentStatusEntryId('com.example/agents', 'sess:1', 'child/2'),
		/^[A-Za-z0-9][A-Za-z0-9._:%-]*$/u,
	);
	assert.notEqual(
		makeAgentStatusEntryId('x/y', 'a'),
		makeAgentStatusEntryId('x/y', 'a', 'a'),
	);
});

test('a batch of upserts and removals is one revision', () => {
	const store = new AgentStatusStore();
	const revisions = [];
	store.subscribe((snapshot) => revisions.push(snapshot.revision));
	assert.equal(store.apply([entry(), entry({ entryId: 'e2' })]), true);
	assert.equal(store.apply([entry({ entryId: 'e3' })], ['e1', 'e2']), true);
	assert.deepEqual(revisions, [1, 2]);
	assert.deepEqual(Object.keys(store.getSnapshot().entries), ['e3']);
});

test('an unchanged entry creates no revision', () => {
	const store = new AgentStatusStore();
	store.apply([entry()]);
	assert.equal(store.apply([entry()]), false);
	assert.equal(store.apply([], ['missing']), false);
	assert.equal(store.getSnapshot().revision, 1);
});

test('acknowledgement clears unread once and records when', () => {
	const store = new AgentStatusStore();
	store.apply([
		entry(),
		entry({ entryId: 'e2', activationTerminalSessionId: 'terminal-2' }),
	]);
	assert.equal(store.markAcknowledged('e1', 50), true);
	assert.equal(store.markAcknowledged('e1', 60), false);
	assert.equal(store.getSnapshot().entries.e1.acknowledgedAt, 50);
	assert.equal(store.markTerminalAcknowledged('terminal-2', 70), 1);
	assert.equal(store.getSnapshot().entries.e2.unread, false);
});

test('clear empties the snapshot in one revision', () => {
	const store = new AgentStatusStore();
	store.apply([entry()]);
	assert.equal(store.clear(), true);
	assert.equal(store.clear(), false);
	assert.deepEqual(store.getSnapshot().entries, {});
});
