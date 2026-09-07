import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
	createAgentExtensionHarness,
	fixtureTerminal,
} from '@terminay/extension-api/testing';
import extension from '../dist/index.js';

/**
 * Captured from a real Grok 1.x session on the developer's machine: the last
 * turn of `events.jsonl`, which ended at 21:41:18 the evening before, followed
 * by the `mcp_*` records Grok appended when the session was resumed at
 * 09:53:45 the next morning. Grok appends to one journal across resumes and
 * Terminay replays it from the top on every bind, so the resumed terminal
 * used to show that finished turn as live work until the replay caught up.
 *
 * The registry names the process; the process has a start time; a record
 * older than the process cannot be its work.
 */
const sessionId = '01a0785e-4001-7570-b63f-9f397b1662a6';
const cwd = '/Users/mark/Documents/Projects/terminay/terminay';
const journal = readFileSync(
	new URL('../fixtures/v0.1/resumed-after-turn.jsonl', import.meta.url),
	'utf8',
)
	.split('\n')
	.filter(Boolean)
	.map((line) => JSON.parse(line));
const journalPath = `/home/test/.grok/sessions/${encodeURIComponent(cwd)}/${sessionId}/events.jsonl`;
const registryPath = '/home/test/.grok/active_sessions.json';
const pid = 4242;

function resumedTerminal(startedAt) {
	return fixtureTerminal({
		foregroundExecutable: 'grok',
		cwd,
		pid,
		startedAt,
		openFilePaths: [],
		files: {
			[registryPath]: [
				[{ session_id: sessionId, pid, cwd, opened_at: startedAt }],
			],
			[journalPath]: journal,
		},
	});
}

test('a resumed Grok process does not replay the previous process’s turn as live', async () => {
	const harness = await createAgentExtensionHarness(extension);
	try {
		// The process started the next morning; the turn ended the night before.
		await harness.observe(resumedTerminal('2026-09-07T09:53:40.000Z'));
		const kinds = harness.events().map((event) => event.kind);
		assert.equal(kinds[0], 'session.started');
		assert.ok(!kinds.includes('turn.started'), 'history opens no turn');
		assert.ok(!kinds.includes('tool.started'), 'history starts no tool');
		assert.equal(
			harness.events().findLast((event) => event.kind === 'agent.done')
				?.outcome,
			'success',
			'the finished turn keeps its outcome',
		);
		assert.equal(harness.projection().working, false);
	} finally {
		await harness.dispose();
	}
});

test('the same journal is live work for the process that wrote it', async () => {
	const harness = await createAgentExtensionHarness(extension);
	try {
		// The process started a minute before the turn: this is its own turn.
		await harness.observe(resumedTerminal('2026-09-06T21:40:00.000Z'));
		const kinds = harness.events().map((event) => event.kind);
		assert.ok(kinds.includes('turn.started'), 'a live turn opens');
		assert.equal(
			harness.events().findLast((event) => event.kind === 'agent.done')
				?.outcome,
			'success',
		);
	} finally {
		await harness.dispose();
	}
});
