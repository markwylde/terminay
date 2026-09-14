import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	createAgentExtensionHarness,
	fixtureTerminal,
} from '@terminay/extension-api/testing';
import extension from '../dist/index.js';
import {
	createClaudeRecordMapper,
	sessionStatusRecord,
} from '../dist/mapping.js';
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

/** What the provider injects for the session file's own status word. */
const status = (word, at = 1_000) => sessionStatusRecord(word, at, undefined);

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

test('no journal record of a turn moves the entry between states', () => {
	// Everything the old mapping read a turn boundary out of, in one journal:
	// the prompt, the rewritten header blocks, `turn_duration`. None of it is a
	// state boundary now, so the entry sits wherever the session file put it.
	const events = collect([
		status('busy'),
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
		'turnStarted',
		'metadataChanged',
		'metadataChanged',
	]);
	assert.equal(
		kinds.indexOf('done'),
		-1,
		'no journal record completes a turn; only the session file does',
	);
});

test('the session file working, then idle, is the whole of a turn', () => {
	const events = collect([
		status('busy', 1_000),
		...header(),
		{
			type: 'user',
			sessionId,
			promptId: 'p1',
			message: { role: 'user', content: 'Inspect the parser' },
		},
		status('idle', 5_000),
	]);
	const kinds = events.map((event) => event.kind);
	assert.equal(kinds[1], 'turnStarted');
	assert.equal(kinds.at(-1), 'done');
	assert.equal(events.at(-1).outcome, 'success');
});

test('binding to a session sitting at its prompt reads idle, never done', () => {
	// `done` is a turn having ended, and it marks the row unread. A session
	// that has run nothing since this terminal bound has ended nothing, so the
	// first status read is a baseline and not a transition.
	const events = collect([status('idle', 1_000), ...header()]);
	assert.deepEqual(
		events.map((event) => event.kind),
		['sessionStarted', 'metadataChanged'],
	);
	// And the first turn after it still completes normally.
	const whole = collect([
		status('idle', 1_000),
		...header(),
		status('busy', 2_000),
		status('idle', 3_000),
	]);
	assert.deepEqual(whole.map((event) => event.kind).slice(-2), [
		'turnStarted',
		'done',
	]);
});

test('a quiet session whose journal holds a finished turn reads done', () => {
	// A resumed conversation: the process is idle, but the journal it reopened
	// already carries a completed turn. History is the one thing a journal is
	// authoritative about, so the row reads done rather than idle.
	const events = collect([
		status('idle', 9_000),
		...header(),
		{
			type: 'assistant',
			sessionId,
			uuid: 'a1',
			timestamp: '2026-09-06T10:00:00.000Z',
			message: { role: 'assistant', content: [], stop_reason: 'end_turn' },
		},
	]);
	assert.equal(events.at(-1).kind, 'done');
	assert.equal(
		events.filter((event) => event.kind === 'done').length,
		1,
		'history settles the row once, not once per record',
	);
});

test('journal history never moves a row the session file has put to work', () => {
	const events = collect([
		status('busy', 9_000),
		...header(),
		{
			type: 'assistant',
			sessionId,
			uuid: 'a1',
			timestamp: '2026-09-06T10:00:00.000Z',
			message: { role: 'assistant', content: [], stop_reason: 'end_turn' },
		},
		{ type: 'system', subtype: 'turn_duration', sessionId },
	]);
	assert.equal(
		events.some((event) => event.kind === 'done'),
		false,
		'the file says busy; no journal record may complete that turn',
	);
});

test('a repeated status word republishes nothing, and shell is quiet like idle', () => {
	const events = collect([
		status('busy', 1_000),
		status('busy', 2_000),
		status('idle', 3_000),
		status('shell', 4_000),
		status('idle', 5_000),
	]);
	assert.deepEqual(
		events.map((event) => event.kind),
		['sessionStarted', 'turnStarted', 'done'],
	);
});

test('the session file waiting is a wait, and leaving it resumes the turn', () => {
	const events = collect([
		sessionStatusRecord('busy', 1_000, undefined),
		sessionStatusRecord('waiting', 2_000, 'permission'),
		sessionStatusRecord('busy', 3_000, undefined),
		sessionStatusRecord('idle', 4_000, undefined),
	]);
	const [, turn, wait, resumed, done] = events;
	assert.equal(turn.kind, 'turnStarted');
	assert.equal(wait.kind, 'waitStarted');
	assert.equal(wait.state, 'waiting');
	assert.equal(wait.reason, 'permission');
	assert.equal(resumed.kind, 'waitFinished');
	assert.equal(done.kind, 'done');
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
		status('busy'),
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

test('a recorded fault stands through the idle that follows it', () => {
	// The CLI writes no `turn_duration` after a fault and returns to its
	// prompt, so its file reports idle within moments. Completing the turn
	// there would replace an attention state with a success that never
	// happened, and the fault would be gone before anyone saw it.
	const events = collect([
		status('busy'),
		...header(),
		{
			type: 'assistant',
			sessionId,
			uuid: 'err-1',
			isApiErrorMessage: true,
			message: { role: 'assistant', content: [] },
		},
		status('idle', 9_000),
	]);
	assert.equal(events.at(-1).kind, 'waitStarted');
	assert.equal(events.at(-1).state, 'blocked');
	assert.equal(
		events.some((event) => event.kind === 'done'),
		false,
		'idle after a fault completes nothing',
	);
});

test('the session going back to work clears a standing fault', () => {
	const events = collect([
		status('busy', 1_000),
		...header(),
		{
			type: 'assistant',
			sessionId,
			uuid: 'err-1',
			isApiErrorMessage: true,
			message: { role: 'assistant', content: [] },
		},
		status('idle', 9_000),
		status('busy', 10_000),
		status('idle', 11_000),
	]);
	const kinds = events.map((event) => event.kind);
	assert.deepEqual(kinds.slice(-2), ['turnStarted', 'done']);
	assert.equal(
		events.at(-1).outcome,
		'success',
		'the next turn completes normally once the fault is behind it',
	);
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
test('the real one-turn journal contributes no state, and the status word is the turn', async () => {
	// A captured journal from the real CLI, replayed whole. Every boundary the
	// old mapping read out of it — the prompt, `end_turn`, `turn_duration`, the
	// rewritten header blocks — is present here and none of it may move the
	// entry. The session file going busy then idle is the entire turn.
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
	const startedAt = Date.parse('2026-09-06T11:00:00.000Z');
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
						sessionFile({ sessionId: capturedSession, startedAt }),
					],
				},
				fileRewrites: {
					[sessionFilePath(PID)]: [
						[
							sessionFile({
								sessionId: capturedSession,
								startedAt,
								status: 'idle',
								statusUpdatedAt: startedAt + 120_000,
							}),
						],
					],
				},
			}),
		);
		const events = harness.events();
		const kinds = events.map((event) => event.kind);
		assert.equal(
			kinds.filter((kind) => kind === 'turn.started').length,
			1,
			'only the session file opens a turn',
		);
		assert.equal(
			kinds.filter((kind) => kind === 'agent.done').length,
			1,
			'only the session file completes one',
		);
		assert.equal(kinds[0], 'session.started');
		assert.equal(kinds.at(-1), 'agent.done', 'the entry ends done');
		const [turn] = events.filter((event) => event.kind === 'turn.started');
		assert.match(
			turn.turnId,
			/^status:/u,
			'the turn is the status, not a record',
		);
		assert.deepEqual(
			events
				.filter((event) => event.kind === 'agent.metadata' && event.title)
				.map((event) => event.title),
			['Reply with the single word ready.', 'Ready', 'Ready'],
			'the journal still supplies the label',
		);
	} finally {
		await harness.dispose();
	}
});
