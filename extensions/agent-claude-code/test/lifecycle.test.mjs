import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	createAgentExtensionHarness,
	fixtureTerminal,
} from '@terminay/extension-api/testing';
import extension from '../dist/index.js';
import { createClaudeRecordMapper } from '../dist/mapping.js';
import { PID, sessionFile, sessionFilePath } from './claude-terminal.mjs';

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
	const session = {
		publish,
		binding: { providerSessionId: sessionId },
		journal: { role: 'root' },
	};
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

test('a later header block neither restarts the session nor opens a turn', () => {
	// The real CLI rewrites its header block as bookkeeping — at session start,
	// again after the user prompt, and again after `turn_duration` — so a header
	// arriving after a completed turn must leave the entry done.
	const events = collect([
		...header(),
		{
			type: 'user',
			sessionId,
			promptId: 'p1',
			message: { role: 'user', content: 'Inspect the parser' },
		},
		{ type: 'system', subtype: 'turn_duration', sessionId },
		{ type: 'mode', mode: 'normal', sessionId },
		{
			type: 'permission-mode',
			permissionMode: 'default',
			sessionId,
			uuid: 'header-2',
		},
		{ type: 'atis-latch', atis: '', sessionId },
		{ type: 'bridge-session', sessionId, bridgeSessionId: 'cse_2' },
	]);
	const kinds = events.map((event) => event.kind);
	assert.equal(
		kinds.filter((kind) => kind === 'sessionStarted').length,
		1,
		'one session start across the whole journal',
	);
	assert.deepEqual(kinds, [
		'sessionStarted',
		'metadataChanged',
		'turnStarted',
		'done',
	]);
	assert.equal(
		kinds.lastIndexOf('turnStarted') < kinds.lastIndexOf('done'),
		true,
		'the trailing header block leaves the entry done, never working',
	);
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

/** Collects what a child journal's records publish for one child id. */
function collectChild(childId, records) {
	const events = [];
	const publish = new Proxy(
		{},
		{
			get: (_t, kind) => (event) => {
				events.push({ kind, ...event });
			},
		},
	);
	const map = createClaudeRecordMapper();
	for (const record of records) {
		map(record, {
			publish,
			binding: { providerSessionId: sessionId },
			journal: { role: 'child', childId },
		});
	}
	return events;
}

test("a child journal drives that child's own state, never the root's", () => {
	const events = collectChild('a94c3c95918d29dc8', [
		{
			isSidechain: true,
			agentId: 'a94c3c95918d29dc8',
			type: 'assistant',
			message: { role: 'assistant', model: 'claude-opus-5', content: [] },
		},
		{ isSidechain: true, type: 'system', subtype: 'turn_duration' },
	]);
	assert.deepEqual(
		events.map((event) => event.kind),
		['subagentStarted', 'subagentDone'],
	);
	assert.equal(events[0].subagentId, 'a94c3c95918d29dc8');
	assert.equal(events[1].subagentId, 'a94c3c95918d29dc8');
	assert.equal(
		events.some((event) => event.kind === 'done'),
		false,
		'a child completing never completes its root',
	);
});

test('a child journal never projects prompts or assistant text', () => {
	const events = collectChild('child-1', [
		{
			isSidechain: true,
			type: 'user',
			message: { role: 'user', content: 'secret child prompt' },
		},
		{
			isSidechain: true,
			type: 'assistant',
			message: {
				role: 'assistant',
				content: [{ type: 'text', text: 'secret child reasoning' }],
			},
		},
	]);
	assert.equal(JSON.stringify(events).includes('secret'), false);
});

/**
 * The record order a real Claude Code 2.1.263 run wrote for one user turn
 * ("Reply with the single word ready."), captured verbatim apart from the
 * conversation payloads. Its header block is rewritten three times — at session
 * start, after the user prompt, and after `turn_duration` — so it is the
 * evidence that a header is bookkeeping rather than a turn boundary.
 */
test('the real one-turn journal ends done, with no turn opened by its rewritten headers', async () => {
	const capturedSession = '359d528f-27eb-4030-9375-7c6ade9b29f8';
	const records = (
		await readFile(
			new URL('../fixtures/real-turn-headers-v01.jsonl', import.meta.url),
			'utf8',
		)
	)
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line));
	const harness = await createAgentExtensionHarness(extension);
	try {
		await harness.observe(
			fixtureTerminal({
				foregroundExecutable: 'claude',
				cwd: '/workspace',
				pid: PID,
				startedAt: '2026-09-06T11:00:00.000Z',
				openFilePaths: [],
				files: {
					[`/home/test/.claude/projects/-workspace/${capturedSession}.jsonl`]:
						records,
					[sessionFilePath(PID)]: [
						sessionFile({
							sessionId: capturedSession,
							startedAt: Date.parse('2026-09-06T11:00:00.000Z'),
						}),
					],
				},
			}),
		);
		const events = harness.events();
		assert.deepEqual(
			events.map((event) => event.kind),
			[
				'session.started',
				// The user prompt opens the only turn the prompt is responsible for.
				'turn.started',
				'agent.metadata',
				'agent.metadata',
				'agent.metadata',
				// The assistant record re-asserts working under its own turn id.
				'turn.started',
				// `end_turn` completes the turn, and `turn_duration` confirms it.
				'agent.done',
				'agent.done',
				// Only the trailing title metadata follows; the headers emit nothing.
				'agent.metadata',
			],
		);
		const starts = events.filter((event) => event.kind === 'turn.started');
		assert.deepEqual(
			starts.map((event) => event.turnId),
			[
				'acdd451b-f02c-4f3e-b133-1aea28468dee',
				'ec83b685-31c6-4e79-9027-67ded43a24ea',
			],
			'only the user prompt and the assistant record open turns',
		);
		assert.equal(starts[0].promptText, 'Reply with the single word ready.');
		const kinds = events.map((event) => event.kind);
		assert.equal(
			kinds.slice(kinds.lastIndexOf('agent.done')).includes('turn.started'),
			false,
			'nothing after the final agent.done projects the entry as working',
		);
	} finally {
		await harness.dispose();
	}
});
