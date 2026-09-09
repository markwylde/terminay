import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentExtensionHarness } from '@terminay/extension-api/testing';
import extension from '../dist/index.js';
import {
	CWD,
	claudeTerminal,
	header,
	journalPath,
	keyFilePath,
	PID,
	sessionFile,
	sessionFilePath,
	titled,
} from './claude-terminal.mjs';

/**
 * Two or more terminals, each running its own `claude` in one directory. This
 * is the ordinary case on a developer's machine, and Claude Code encodes the
 * project directory from the cwd, so every terminal lists every other
 * terminal's journal beside its own.
 *
 * Each terminal binds the journal named by the `sessions/<pid>.json` file its
 * own process wrote, and nothing else. Every fixture here therefore supplies
 * that file, a pid on the process, and a project directory holding at least one
 * journal older than the process under test — the history a real directory
 * always carries and the case the previous creation-time rule could not reach.
 */
const live = '5f2aff08-eab3-4852-96eb-48235fc7f471';
const own = 'bf0b34e1-4afc-4b93-8389-80caa0b589a4';
const third = 'c1d0f8a2-3b4e-4f5a-9c6d-7e8f90a1b2c3';

/** The other terminal's session: created yesterday, appended to a moment ago. */
const sharedJournals = {
	[live]: titled(live, 'Another terminal'),
	[own]: titled(own, 'This terminal'),
};

async function observed(terminal) {
	const harness = await createAgentExtensionHarness(extension);
	try {
		await harness.observe(terminal);
		return {
			sessionId: harness.observation()?.binding?.providerSessionId,
			state: harness.observation()?.state,
			events: harness.events(),
		};
	} finally {
		await harness.dispose();
	}
}

const boundSessionOf = async (terminal) => (await observed(terminal)).sessionId;

test('a fresh process binds its own session beside a live older one', async () => {
	assert.equal(
		await boundSessionOf(
			claudeTerminal({
				sessionId: own,
				journals: sharedJournals,
				older: [live],
				appendedLast: live,
			}),
		),
		own,
	);
});

test('the other terminal in the same directory keeps binding its own session', async () => {
	assert.equal(
		await boundSessionOf(
			claudeTerminal({
				pid: 5150,
				sessionId: live,
				processStartedAt: '2026-09-05T11:00:00.000Z',
				journals: sharedJournals,
				older: [live],
				appendedLast: live,
			}),
		),
		live,
	);
});

test('claude --resume binds the resumed journal, not the one appended last', async () => {
	// `claude --resume` with no id opens the CLI's own picker, so the resumed
	// session id is never on the command line. The resumed journal was created
	// before this process and the other terminal has typed since, so every
	// timestamp in the directory points at the wrong session.
	assert.equal(
		await boundSessionOf(
			claudeTerminal({
				arguments: ['--resume'],
				sessionId: live,
				journals: {
					[live]: titled(live, 'Resumed here'),
					[third]: titled(third, 'Another terminal'),
				},
				older: [live, third],
				appendedLast: third,
			}),
		),
		live,
		'the resumed terminal must bind the session its own session file names',
	);
});

test('a resumed process that has since cleared binds the file’s id, not the argument’s', async () => {
	// `claude --resume <uuid>` followed by `/clear` inside the process: the
	// session file names the new conversation and the command line still names
	// the resumed one. The file is the evidence.
	assert.equal(
		await boundSessionOf(
			claudeTerminal({
				arguments: ['--resume', live],
				sessionId: own,
				journals: sharedJournals,
				older: [live],
				appendedLast: live,
			}),
		),
		own,
	);
});

test('claude --continue binds the continued journal beside a live newer one', async () => {
	assert.equal(
		await boundSessionOf(
			claudeTerminal({
				arguments: ['--continue'],
				sessionId: live,
				journals: {
					[live]: titled(live, 'Continued here'),
					[third]: titled(third, 'Another terminal'),
				},
				older: [live, third],
				appendedLast: third,
			}),
		),
		live,
	);
});

test('no session file binds nothing, however the directory is timed', async () => {
	const result = await observed(
		claudeTerminal({
			sessionId: own,
			omitSessionFile: true,
			journals: sharedJournals,
			older: [live],
			appendedLast: live,
		}),
	);
	assert.equal(result.state, 'not-bound');
	assert.deepEqual(result.events, []);
});

test('a session file whose cwd differs from the process binds nothing', async () => {
	const result = await observed(
		claudeTerminal({
			sessionId: own,
			fileCwd: '/somewhere/else',
			journals: sharedJournals,
			older: [live],
		}),
	);
	assert.equal(result.state, 'not-bound');
});

test('a session file whose pid differs from the process binds nothing', async () => {
	const result = await observed(
		claudeTerminal({
			sessionId: own,
			sessionFileRecord: sessionFile({
				pid: PID + 1,
				sessionId: own,
				startedAt: Date.parse('2026-09-06T11:00:00.000Z'),
			}),
			journals: sharedJournals,
			older: [live],
		}),
	);
	assert.equal(result.state, 'not-bound');
});

test('a session file naming a session with no journal binds nothing', async () => {
	const result = await observed(
		claudeTerminal({
			sessionId: third,
			journals: sharedJournals,
			older: [live],
			appendedLast: live,
		}),
	);
	assert.equal(result.state, 'not-bound');
});

test('a journal whose header names a different session binds nothing', async () => {
	const result = await observed(
		claudeTerminal({
			sessionId: own,
			journals: {
				[live]: titled(live, 'Another terminal'),
				// The file names `own`; this journal's first record names `third`.
				[own]: [header(third), { type: 'ai-title', aiTitle: 'Mismatched' }],
			},
			older: [live],
		}),
	);
	assert.equal(result.state, 'not-bound');
});

test('two claude descendants with accepted session files bind nothing', async () => {
	const nested = 7100;
	const result = await observed(
		claudeTerminal({
			sessionId: own,
			journals: sharedJournals,
			older: [live],
			extraDescendants: [
				{
					executableName: 'claude',
					cwd: CWD,
					pid: nested,
					startedAt: '2026-09-06T11:00:00.000Z',
					id: 'nested-claude',
				},
			],
			extraFiles: {
				[sessionFilePath(nested)]: [
					sessionFile({
						pid: nested,
						sessionId: live,
						startedAt: Date.parse('2026-09-06T11:00:00.000Z'),
					}),
				],
			},
		}),
	);
	assert.equal(result.state, 'not-bound');
});

test('a session file four seconds from the process start binds', async () => {
	assert.equal(
		await boundSessionOf(
			claudeTerminal({
				sessionId: own,
				fileStartedAt: Date.parse('2026-09-06T11:00:00.000Z') + 4_000,
				journals: sharedJournals,
				older: [live],
				appendedLast: live,
			}),
		),
		own,
	);
});

test('a session file six seconds from the process start binds nothing', async () => {
	const result = await observed(
		claudeTerminal({
			sessionId: own,
			fileStartedAt: Date.parse('2026-09-06T11:00:00.000Z') + 6_000,
			journals: sharedJournals,
			older: [live],
			appendedLast: live,
		}),
	);
	assert.equal(
		result.state,
		'not-bound',
		'a pid reused after a crash left a stale file must not bind',
	);
});

test('a stale session file left by a dead process hours earlier binds nothing', async () => {
	const result = await observed(
		claudeTerminal({
			sessionId: own,
			fileStartedAt: Date.parse('2026-09-06T04:00:00.000Z'),
			journals: sharedJournals,
			older: [live],
		}),
	);
	assert.equal(result.state, 'not-bound');
});

test('the session file naming a new session moves the entry to the new journal', async () => {
	// `/clear`, or `/resume` inside the running process: the CLI rewrites the
	// same pid-keyed file with a new `sessionId` and starts appending to the
	// journal that names. The entry follows the process rather than sitting on a
	// journal nothing is writing any more.
	//
	// The canonical root is NOT re-bound, because the host refuses it: a live
	// context publishing a binding with a different `providerSessionId` is
	// rejected by `ingestExtensionLifecycle` with "extension agent session
	// replacement requires a separate binding publication", and the
	// `bindExtensionSession` path that would retire and re-materialise the root
	// has no caller. `packages/server-core/test/extension-live-rebind.test.mjs`
	// holds that host behaviour still, so this provider is told when it changes.
	const harness = await createAgentExtensionHarness(extension);
	try {
		await harness.observe(
			claudeTerminal({
				sessionId: own,
				journals: {
					[live]: titled(live, 'Another terminal'),
					[own]: titled(own, 'First conversation'),
					[third]: titled(third, 'Second conversation'),
				},
				older: [live],
				appendedLast: live,
				fileRewrites: {
					[sessionFilePath(PID)]: [
						[
							sessionFile({
								sessionId: third,
								startedAt: Date.parse('2026-09-06T11:00:00.000Z'),
							}),
						],
					],
				},
			}),
		);
		assert.deepEqual(
			harness.events().map((event) => event.kind),
			['session.started', 'agent.metadata', 'agent.metadata'],
			'one root, relabelled by the conversation the process moved to',
		);
		assert.deepEqual(
			harness
				.events()
				.filter((event) => event.kind === 'agent.metadata')
				.map((event) => event.title),
			['First conversation', 'Second conversation'],
		);
	} finally {
		await harness.dispose();
	}
});

test('a conversation switch does not carry the previous conversation’s state', async () => {
	// The turn the first conversation left open, and the title it had chosen,
	// must not survive into the conversation that replaces it.
	const harness = await createAgentExtensionHarness(extension);
	try {
		await harness.observe(
			claudeTerminal({
				sessionId: own,
				journals: {
					[own]: [
						header(own),
						{ type: 'ai-title', sessionId: own, aiTitle: 'First conversation' },
						{
							type: 'user',
							sessionId: own,
							promptId: 'prompt-1',
							message: { role: 'user', content: 'a prompt left mid-turn' },
						},
					],
					[third]: [
						header(third),
						{
							type: 'last-prompt',
							sessionId: third,
							lastPrompt: 'Second conversation',
						},
					],
				},
				fileRewrites: {
					[sessionFilePath(PID)]: [
						[
							sessionFile({
								sessionId: third,
								startedAt: Date.parse('2026-09-06T11:00:00.000Z'),
							}),
						],
					],
				},
			}),
		);
		// `last-prompt` relabels only because the first conversation's chosen
		// title was cleared with the rest of its state.
		assert.equal(
			harness
				.events()
				.filter((event) => event.kind === 'agent.metadata')
				.at(-1)?.title,
			'Second conversation',
		);
		assert.equal(
			harness.projection().working,
			false,
			'a turn abandoned by the switch does not leave the entry working',
		);
		assert.deepEqual(
			harness
				.events()
				.filter((event) => event.kind === 'agent.done')
				.map((event) => event.outcome),
			['cancelled'],
		);
	} finally {
		await harness.dispose();
	}
});

test('binding reads the session file and the journal, and never the key sibling', async () => {
	const reads = [];
	await observed(
		claudeTerminal({
			sessionId: own,
			journals: sharedJournals,
			older: [live],
			appendedLast: live,
			onFileRead: (path) => reads.push(path),
		}),
	);
	assert.equal(
		reads.includes(keyFilePath(PID)),
		false,
		'the peer-token sibling must never be opened',
	);
	assert.deepEqual(
		[...new Set(reads)].sort(),
		[sessionFilePath(PID), journalPath(own)].sort(),
		'only this process’s session file and its own journal are read',
	);
});

test('switching to a conversation filed under another directory follows it', async () => {
	// `/resume` inside the running process onto a conversation started
	// elsewhere: the pid-keyed file names it, but its journal stayed under the
	// directory it was created in, so the derived path has nothing.
	const elsewhere = `/home/test/.claude/projects/-origin/${third}.jsonl`;
	const harness = await createAgentExtensionHarness(extension);
	try {
		await harness.observe(
			claudeTerminal({
				sessionId: own,
				journals: sharedJournals,
				older: [live],
				extraFiles: { [elsewhere]: titled(third, 'Resumed from elsewhere') },
				fileRewrites: {
					[sessionFilePath(PID)]: [
						[
							sessionFile({
								sessionId: third,
								startedAt: Date.parse('2026-09-06T11:00:00.000Z'),
							}),
						],
					],
				},
			}),
		);
		assert.deepEqual(
			harness
				.events()
				.filter((event) => event.kind === 'agent.metadata')
				.map((event) => event.title),
			['This terminal', 'Resumed from elsewhere'],
			'the row follows the conversation the process moved to',
		);
	} finally {
		await harness.dispose();
	}
});

test('a switch to a conversation with no findable journal leaves the binding alone', async () => {
	const harness = await createAgentExtensionHarness(extension);
	try {
		await harness.observe(
			claudeTerminal({
				sessionId: own,
				journals: sharedJournals,
				older: [live],
				fileRewrites: {
					[sessionFilePath(PID)]: [
						[
							sessionFile({
								sessionId: third,
								startedAt: Date.parse('2026-09-06T11:00:00.000Z'),
							}),
						],
					],
				},
			}),
		);
		assert.deepEqual(
			harness
				.events()
				.filter((event) => event.kind === 'agent.metadata')
				.map((event) => event.title),
			['This terminal'],
			'an unresolvable switch retires nothing',
		);
		assert.equal(
			harness.observation()?.binding?.providerSessionId,
			own,
			'the bound session is unchanged',
		);
	} finally {
		await harness.dispose();
	}
});
