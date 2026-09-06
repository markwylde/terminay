import assert from 'node:assert/strict';
import test from 'node:test';
import { createGrokRecordMapper } from '../dist/provider.js';

const sessionId = '01a0760d-1be1-78a3-bb81-13bd11557257';

/** Collects what the mapping publishes for a bound Grok root. */
function collect(records) {
	const events = [];
	const publish = new Proxy(
		{},
		{
			get: (_target, kind) => (event) => {
				events.push({ kind, ...event });
			},
		},
	);
	const context = {
		publish,
		binding: { providerSessionId: sessionId },
		journal: { role: 'root' },
	};
	const map = createGrokRecordMapper();
	for (const record of records) map(record, context);
	return events;
}

const turnStarted = {
	type: 'turn_started',
	session_id: sessionId,
	session_relationship: 'primary',
	model_id: 'grok-4',
};

test('a subagent is enumerated and carries its own state', () => {
	const events = collect([
		turnStarted,
		{
			type: 'subagent_progress',
			subagent_id: 'sub-1',
			current_agent_label: 'Explore parser',
		},
		{ type: 'subagent_finished', subagent_id: 'sub-1', outcome: 'completed' },
	]);
	const started = events.find((event) => event.kind === 'subagentStarted');
	assert.equal(started.subagentId, 'sub-1');
	assert.equal(started.title, 'Explore parser');
	assert.equal(started.parentAgentId, sessionId);
	const done = events.find((event) => event.kind === 'subagentDone');
	assert.equal(done.subagentId, 'sub-1');
	assert.equal(done.outcome, 'success');
});

test('repeated progress for one child does not restart it', () => {
	const events = collect([
		turnStarted,
		{ type: 'subagent_progress', subagent_id: 'sub-1', turn_count: 1 },
		{ type: 'subagent_progress', subagent_id: 'sub-1', turn_count: 2 },
	]);
	assert.equal(
		events.filter((event) => event.kind === 'subagentStarted').length,
		1,
	);
});

test('children complete independently and never complete their root', () => {
	const events = collect([
		turnStarted,
		{ type: 'subagent_progress', subagent_id: 'sub-1' },
		{ type: 'subagent_progress', subagent_id: 'sub-2' },
		{ type: 'subagent_finished', subagent_id: 'sub-1', outcome: 'completed' },
	]);
	assert.deepEqual(
		events
			.filter((event) => event.kind === 'subagentDone')
			.map((event) => event.subagentId),
		['sub-1'],
	);
	assert.equal(
		events.some((event) => event.kind === 'done'),
		false,
		'the root stays working',
	);
});

test('a completion with no prior progress still lands beneath the root', () => {
	const events = collect([
		turnStarted,
		{ type: 'subagent_finished', subagent_id: 'sub-9', outcome: 'error' },
	]);
	const started = events.find((event) => event.kind === 'subagentStarted');
	assert.equal(started.subagentId, 'sub-9');
	assert.equal(events.at(-1).outcome, 'error');
});

test('a recorded fault that halts a turn blocks the root', () => {
	const events = collect([
		turnStarted,
		{ type: 'auth_failed', error_kind: 'auth_expired' },
	]);
	const wait = events.at(-1);
	assert.equal(wait.kind, 'waitStarted');
	assert.equal(wait.state, 'blocked');
	assert.equal(wait.inferred, true);
	assert.equal(wait.reason, 'auth_expired');
});

test('a repeated fault does not republish the blocked state', () => {
	const events = collect([
		turnStarted,
		{ type: 'rate_limited', error_kind: 'rate_limit' },
		{ type: 'rate_limited', error_kind: 'rate_limit' },
	]);
	assert.equal(
		events.filter((event) => event.kind === 'waitStarted').length,
		1,
	);
});

test('a turn_ended after a fault is an ordinary completion outcome', () => {
	const events = collect([
		turnStarted,
		{ type: 'turn_failed', error_kind: 'model_error' },
		{ type: 'turn_ended', outcome: 'error' },
	]);
	assert.deepEqual(events.map((event) => event.kind).slice(-2), [
		'waitStarted',
		'done',
	]);
	assert.equal(events.at(-1).outcome, 'error');
});

test('an explicit permission request stays explicit, not inferred', () => {
	const events = collect([
		turnStarted,
		{ type: 'permission_requested', tool_name: 'run_terminal_command' },
	]);
	const wait = events.at(-1);
	assert.equal(wait.state, 'waiting');
	assert.equal(
		wait.inferred,
		undefined,
		'Grok records permission requests explicitly',
	);
});
