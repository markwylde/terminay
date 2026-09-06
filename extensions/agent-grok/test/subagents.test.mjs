import assert from 'node:assert/strict';
import test from 'node:test';
import { createGrokRecordMapper } from '../dist/provider.js';
import { subagentRecordFrom } from '../dist/subagents.js';

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

/**
 * Captured from a real `grok --always-approve -p` run that spawned two
 * subagents: `meta.json` appears with status running and is rewritten to
 * completed, so children finish independently.
 */
const META_RUNNING = {
	subagent_id: '01a076d9-3575-7780-8725-79906444cb49',
	parent_session_id: sessionId,
	child_session_id: '01a076d9-3575-7780-8725-79906444cb49',
	subagent_type: 'general-purpose',
	description: 'Compute 17 times 19',
	prompt: 'Compute 17 times 19. Reply with only the resulting number.',
	status: 'running',
	started_at: '2026-09-06T13:11:29.862137Z',
	child_cwd: '/private/tmp/grok-subagent-probe',
	effective_model_id: 'grok-4.6',
};
const META_COMPLETED = {
	...META_RUNNING,
	status: 'completed',
	completed_at: '2026-09-06T13:11:32.433288Z',
	duration_ms: 2604,
};

const record = (meta) => subagentRecordFrom(meta);

test('a subagent is enumerated from its own meta.json and carries its own state', () => {
	const events = collect([
		turnStarted,
		record(META_RUNNING),
		record(META_COMPLETED),
	]);
	const started = events.find((event) => event.kind === 'subagentStarted');
	assert.equal(started.subagentId, META_RUNNING.subagent_id);
	assert.equal(started.title, 'Compute 17 times 19');
	assert.equal(started.parentAgentId, sessionId);
	const done = events.find((event) => event.kind === 'subagentDone');
	assert.equal(done.subagentId, META_RUNNING.subagent_id);
	assert.equal(done.outcome, 'success');
});

test('a child prompt and output are never projected', () => {
	const events = collect([turnStarted, record(META_RUNNING)]);
	assert.equal(JSON.stringify(events).includes('Reply with only'), false);
});

test('a repeated running record does not restart the child', () => {
	const events = collect([
		turnStarted,
		record(META_RUNNING),
		record(META_RUNNING),
	]);
	assert.equal(
		events.filter((event) => event.kind === 'subagentStarted').length,
		1,
	);
});

test('children complete independently and never complete their root', () => {
	const second = {
		...META_RUNNING,
		subagent_id: '01a076d9-0000-0000-0000-000000000002',
		child_session_id: '01a076d9-0000-0000-0000-000000000002',
		description: 'Sum 1 through 100',
	};
	const events = collect([
		turnStarted,
		record(META_RUNNING),
		record(second),
		record(META_COMPLETED),
	]);
	assert.deepEqual(
		events
			.filter((event) => event.kind === 'subagentDone')
			.map((event) => event.subagentId),
		[META_RUNNING.subagent_id],
	);
	assert.equal(
		events.some((event) => event.kind === 'done'),
		false,
		'the root stays working while a sibling runs',
	);
});

test('a child declaring another parent is never attached', () => {
	const events = collect([
		turnStarted,
		record({ ...META_RUNNING, parent_session_id: 'some-other-session' }),
	]);
	assert.equal(
		events.some((event) => event.kind === 'subagentStarted'),
		false,
	);
});

test('a meta.json without identity is ignored', () => {
	assert.equal(subagentRecordFrom({ description: 'no ids' }), undefined);
	assert.equal(subagentRecordFrom(null), undefined);
	assert.equal(subagentRecordFrom([1, 2]), undefined);
});

test('an interrupted child completes with a non-success outcome', () => {
	const events = collect([
		turnStarted,
		record(META_RUNNING),
		record({ ...META_RUNNING, status: 'cancelled' }),
	]);
	assert.equal(events.at(-1).outcome, 'cancelled');
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
