import assert from 'node:assert/strict';
import test from 'node:test';
import { createClaudeRecordMapper } from '../dist/mapping.js';

const sessionId = '5f2aff08-eab3-4852-96eb-48235fc7f471';

/** Collects what the mapping publishes, in order, without a full harness. */
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
	const session = { publish, binding: { providerSessionId: sessionId } };
	const map = createClaudeRecordMapper();
	for (const record of records) map(record, session);
	return events;
}

const header = (mode = 'default') => [
	{ type: 'last-prompt', lastPrompt: 'Investigate the parser', sessionId },
	{ type: 'mode', mode: 'normal', sessionId },
	{
		type: 'permission-mode',
		permissionMode: mode,
		sessionId,
		uuid: 'header-1',
	},
	{ type: 'atis-latch', atis: '', sessionId },
	{ type: 'bridge-session', sessionId, bridgeSessionId: 'cse_1' },
];

test('the first header block starts the session exactly once', () => {
	const events = collect(header());
	assert.deepEqual(
		events.map((event) => event.kind),
		['sessionStarted', 'metadataChanged'],
	);
	assert.equal(events[0].title, 'Claude Code');
	assert.equal(events[1].title, 'Investigate the parser');
});

test('a later header block opens a turn instead of restarting the session', () => {
	const events = collect([
		...header(),
		{ type: 'system', subtype: 'turn_duration', sessionId },
		{ type: 'mode', mode: 'normal', sessionId },
		{
			type: 'permission-mode',
			permissionMode: 'default',
			sessionId,
			uuid: 'header-2',
		},
		{ type: 'atis-latch', atis: '', sessionId },
	]);
	const kinds = events.map((event) => event.kind);
	assert.equal(
		kinds.filter((kind) => kind === 'sessionStarted').length,
		1,
		'one session start across two turns',
	);
	assert.deepEqual(kinds.slice(-2), ['done', 'turnStarted']);
	assert.equal(events.at(-1).turnId, 'header-2');
});

test('a turn completes on turn_duration', () => {
	const events = collect([
		...header(),
		{
			type: 'user',
			sessionId,
			promptId: 'p1',
			message: { role: 'user', content: 'Inspect the parser' },
		},
		{ type: 'system', subtype: 'turn_duration', durationMs: 4_000, sessionId },
	]);
	assert.deepEqual(events.map((event) => event.kind).slice(-2), [
		'turnStarted',
		'done',
	]);
	assert.equal(events.at(-1).outcome, 'success');
});

test('a title supersedes the prompt label and a later prompt does not overwrite it', () => {
	const events = collect([
		...header(),
		{ type: 'ai-title', aiTitle: 'Parser investigation', sessionId },
		{ type: 'last-prompt', lastPrompt: 'another prompt entirely', sessionId },
	]);
	const titles = events
		.filter((event) => event.kind === 'metadataChanged')
		.map((event) => event.title);
	assert.deepEqual(titles, ['Investigate the parser', 'Parser investigation']);
});

test('AskUserQuestion is an ordinary tool, never a live wait', () => {
	const events = collect([
		...header(),
		{
			type: 'assistant',
			sessionId,
			uuid: 'a1',
			message: {
				role: 'assistant',
				content: [
					{
						type: 'tool_use',
						id: 'toolu-q',
						name: 'AskUserQuestion',
						input: { questions: 'private' },
					},
				],
			},
		},
	]);
	assert.equal(
		events.some((event) => event.kind === 'waitStarted'),
		false,
	);
	assert.ok(
		events.some(
			(event) => event.kind === 'toolStarted' && event.toolId === 'toolu-q',
		),
	);
});

test('an api error record blocks the entry', () => {
	const events = collect([
		...header(),
		{
			type: 'assistant',
			sessionId,
			uuid: 'err-1',
			isApiErrorMessage: true,
			message: { role: 'assistant', content: [] },
		},
	]);
	const wait = events.at(-1);
	assert.equal(wait.kind, 'waitStarted');
	assert.equal(wait.state, 'blocked');
	assert.equal(wait.reason, 'api-error');
});

test('an api error followed by a completed turn ends as done', () => {
	const events = collect([
		...header(),
		{
			type: 'assistant',
			sessionId,
			uuid: 'err-1',
			isApiErrorMessage: true,
			message: { role: 'assistant', content: [] },
		},
		{ type: 'system', subtype: 'turn_duration', sessionId },
	]);
	assert.deepEqual(events.map((event) => event.kind).slice(-2), [
		'waitStarted',
		'done',
	]);
});

test('a subagent starts at its launch and completes on its task notification', () => {
	const events = collect([
		...header(),
		{
			type: 'assistant',
			sessionId,
			uuid: 'a1',
			message: {
				role: 'assistant',
				model: 'claude-opus-5',
				content: [
					{
						type: 'tool_use',
						id: 'toolu_01U4',
						name: 'Agent',
						input: {
							description: 'Find status logic',
							prompt: 'look',
							subagent_type: 'Explore',
						},
					},
				],
			},
		},
		{
			type: 'user',
			sessionId,
			uuid: 'r1',
			message: {
				role: 'user',
				content: [
					{
						type: 'tool_result',
						tool_use_id: 'toolu_01U4',
						content: 'Async agent launched successfully.',
					},
				],
			},
		},
		{
			type: 'user',
			sessionId,
			uuid: 'n1',
			message: {
				role: 'user',
				content:
					'<task-notification>\n<task-id>a94c3c95918d29dc8</task-id>\n<tool-use-id>toolu_01U4</tool-use-id>\n<status>completed</status>\n</task-notification>',
			},
		},
	]);
	const started = events.find((event) => event.kind === 'subagentStarted');
	assert.equal(started.subagentId, 'toolu_01U4');
	assert.equal(started.title, 'Find status logic');
	const finished = events.find((event) => event.kind === 'subagentDone');
	assert.equal(finished.subagentId, 'toolu_01U4');
	assert.equal(finished.outcome, 'success');
});

test('a task notification is never projected as a prompt label', () => {
	const events = collect([
		...header(),
		{
			type: 'user',
			sessionId,
			uuid: 'n1',
			message: {
				role: 'user',
				content:
					'<task-notification><task-id>x</task-id><tool-use-id>unknown</tool-use-id><status>completed</status></task-notification>',
			},
		},
	]);
	assert.equal(
		events.some((event) => JSON.stringify(event).includes('task-notification')),
		false,
	);
	assert.equal(
		events.some((event) => event.kind === 'turnStarted'),
		false,
	);
});

test('a system reminder is never projected as a prompt label', () => {
	const events = collect([
		...header(),
		{
			type: 'user',
			sessionId,
			promptId: 'p9',
			message: {
				role: 'user',
				content: '<system-reminder>private</system-reminder>',
			},
		},
	]);
	assert.equal(
		events.some((event) => event.kind === 'turnStarted'),
		false,
	);
});
