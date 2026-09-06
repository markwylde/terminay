import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createOpenCodeRecordMapper } from '../dist/index.js';

/**
 * The fixture is the real `event` log of one conformance run of OpenCode CLI
 * 1.18.27 (`opencode --prompt "Reply with the single word ready."`), taken from
 * the store's aggregate for the root session below. Every free-text carrier —
 * prompt, reply, reasoning and provider metadata — was removed; only ids,
 * types, roles, part states, timestamps and the session title and slug remain.
 */
const rootId = 'ses_f88d83917ffeqt3V7qobmQ1J0h';

async function replayFixture() {
	const text = await readFile(
		new URL('../fixtures/v0.1/real-single-turn.jsonl', import.meta.url),
		'utf8',
	);
	const published = [];
	const publish = new Proxy(
		{},
		{
			get: (_target, kind) => (event) => {
				published.push({ kind, ...event });
			},
		},
	);
	const map = createOpenCodeRecordMapper(rootId);
	for (const line of text.split('\n')) {
		if (line.trim().length === 0) continue;
		map(JSON.parse(line), { publish });
	}
	return published;
}

test('a real single-turn store run opens exactly one turn and ends done', async () => {
	const events = await replayFixture();
	assert.deepEqual(
		events.map((event) => event.kind),
		[
			// session.created: the root is named by its slug, then by its title.
			'sessionStarted',
			'metadataChanged',
			'metadataChanged',
			// The user message opens the only turn of the run.
			'turnStarted',
			// Three session.updated rows re-state the title as OpenCode generates
			// it and then records cost and summary.
			'metadataChanged',
			'metadataChanged',
			'metadataChanged',
			// The assistant message is stored twice carrying `finish: "stop"`;
			// OpenCode records the completion, then the completion timestamp.
			'done',
			'done',
			'metadataChanged',
		],
	);
	assert.equal(events[1].title, 'hidden-moon');
	assert.deepEqual(
		events.filter((event) => event.kind === 'done').map((e) => e.outcome),
		['success', 'success'],
	);
});

test('a re-stored user message never reopens a finished turn', async () => {
	const events = await replayFixture();
	// The run's last row is a `message.updated` for the SAME user message, saved
	// again after the assistant completed. It must not start a second turn, or
	// the entry stays working forever.
	const turns = events.filter((event) => event.kind === 'turnStarted');
	assert.equal(turns.length, 1);
	assert.equal(turns[0].turnId, 'opencode:turn:msg_07727c7870015cR7PO11ine0Eh');

	let working = false;
	for (const event of events) {
		if (event.kind === 'turnStarted') working = true;
		if (event.kind === 'done') working = false;
	}
	assert.equal(working, false, 'the entry is not working after the last done');
});

/**
 * A second conformance run of the same CLI build, in which the model launched
 * three `task` children concurrently and the harness then quit while they ran.
 * Only the children's short `description` labels survive from the tool input;
 * their prompts and every other payload body were removed.
 */
const subagentRootId = 'ses_f88d26422ffeROudlrgQNIAGDg';

async function replaySubagents() {
	const text = await readFile(
		new URL('../fixtures/v0.1/real-subagents.jsonl', import.meta.url),
		'utf8',
	);
	const published = [];
	const publish = new Proxy(
		{},
		{
			get: (_target, kind) => (event) => {
				published.push({ kind, ...event });
			},
		},
	);
	const map = createOpenCodeRecordMapper(subagentRootId);
	for (const line of text.split('\n')) {
		if (line.trim().length === 0) continue;
		map(JSON.parse(line), { publish });
	}
	return published;
}

test('every real task child is enumerated with its label', async () => {
	const events = await replaySubagents();
	const started = events.filter((event) => event.kind === 'subagentStarted');
	assert.equal(started.length, 3);
	for (const child of started) {
		assert.equal(child.parentAgentId, subagentRootId);
		assert.equal(typeof child.title, 'string');
		assert.ok(child.title.length > 0, 'a child is never left unlabelled');
	}
	assert.deepEqual(
		started.map((child) => child.subagentId),
		[
			'call_ec0c9be2c45e4b178f7bc83e',
			'call_a9d7d09d64f944728fc90230',
			'call_7e73a9a21ab94aa99d9678d1',
		],
	);
	// The harness quit while the children ran, so OpenCode recorded each part as
	// an interrupted error.
	assert.deepEqual(
		events
			.filter((event) => event.kind === 'subagentDone')
			.map((c) => c.outcome),
		['error', 'error', 'error'],
	);
});

test('a real task part never reports a permission wait', async () => {
	const events = await replaySubagents();
	// Each task part is recorded `pending` before its input streams in. That is
	// the ordinary first state of every tool part, and this run answered no
	// approval prompt, so nothing may be published as waiting.
	assert.deepEqual(
		events.filter((event) => /^wait/u.test(event.kind)),
		[],
	);
});
