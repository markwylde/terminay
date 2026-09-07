import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
	createAgentExtensionHarness,
	fixtureTerminal,
} from '@terminay/extension-api/testing';
import extension, { claudeProjectDirectoryPath } from '../dist/index.js';

/**
 * The CLI tells the truth about itself in `sessions/<pid>.json`. These
 * fixtures are that file and the tail of the journal it named, captured from
 * a real session on the developer's machine at the moment the Agents pane
 * showed WORKING while the file said idle. The journal ends on a completed
 * turn followed by header records; the app was still replaying history and
 * painting old turns as live. Whatever the journal replays, a session whose
 * CLI says idle must not be shown working.
 */
const sessionFile = JSON.parse(
	readFileSync(
		new URL('../fixtures/idle-after-turn-v01.json', import.meta.url),
		'utf8',
	),
);
const journal = readFileSync(
	new URL('../fixtures/idle-after-turn-v01.jsonl', import.meta.url),
	'utf8',
)
	.split('\n')
	.filter(Boolean)
	.map((line) => JSON.parse(line));
const home = '/home/test';
const projectDirectory = `${home}/${claudeProjectDirectoryPath(sessionFile.cwd)}`;
const journalPath = `${projectDirectory}/${sessionFile.sessionId}.jsonl`;
const sessionFilePath = `${home}/.claude/sessions/${sessionFile.pid}.json`;

function terminal(file, records) {
	return fixtureTerminal({
		foregroundExecutable: 'claude',
		cwd: file.cwd,
		pid: file.pid,
		startedAt: new Date(file.startedAt).toISOString(),
		openFilePaths: [],
		files: { [journalPath]: records, [sessionFilePath]: [file] },
	});
}

test('a session the CLI reports idle is not shown working, whatever its journal replays', async () => {
	const harness = await createAgentExtensionHarness(extension);
	try {
		await harness.observe(terminal(sessionFile, journal));
		const projection = harness.projection();
		assert.equal(projection.sessionStarted, true);
		assert.equal(projection.working, false, 'the CLI says idle');
		assert.equal(projection.waiting, false);
		assert.ok(projection.title, 'the session keeps its title');
		assert.deepEqual(
			harness.events().filter((event) => event.kind === 'turn.started'),
			[],
			'history replays no turn',
		);
	} finally {
		await harness.dispose();
	}
});

test('a root turn stopped before its turn_duration is closed by the interruption record', async () => {
	// Records written after the idle mark are live. A prompt opens a turn; the
	// user stops it; the CLI writes only the interruption, never a
	// `turn_duration`.
	const after = (seconds) =>
		new Date(sessionFile.statusUpdatedAt + seconds * 1000).toISOString();
	const live = [
		...journal,
		{
			type: 'user',
			sessionId: sessionFile.sessionId,
			uuid: 'live-prompt',
			timestamp: after(30),
			message: { role: 'user', content: 'a prompt the user then stops' },
		},
		{
			type: 'assistant',
			sessionId: sessionFile.sessionId,
			uuid: 'live-assistant',
			requestId: 'req-live',
			timestamp: after(35),
			message: {
				role: 'assistant',
				model: 'claude-fable-5-1',
				stop_reason: 'tool_use',
				content: [
					{ type: 'tool_use', id: 'toolu_live', name: 'Bash', input: {} },
				],
			},
		},
		{
			type: 'user',
			sessionId: sessionFile.sessionId,
			uuid: 'live-interrupted',
			timestamp: after(40),
			message: {
				role: 'user',
				content: [{ type: 'text', text: '[Request interrupted by user]' }],
			},
		},
	];
	const harness = await createAgentExtensionHarness(extension);
	try {
		await harness.observe(terminal(sessionFile, live));
		const kinds = harness.events().map((event) => event.kind);
		assert.ok(kinds.includes('turn.started'), 'the live prompt opened a turn');
		assert.equal(harness.projection().working, false, 'the turn was stopped');
		assert.equal(
			harness.events().findLast((event) => event.kind === 'agent.done')
				?.outcome,
			'cancelled',
		);
	} finally {
		await harness.dispose();
	}
});
