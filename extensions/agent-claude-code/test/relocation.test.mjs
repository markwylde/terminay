import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentExtensionHarness } from '@terminay/extension-api/testing';
import extension, { claudeProjectDirectoryPath } from '../dist/index.js';
import {
	CWD,
	HOME,
	PID,
	claudeTerminal,
	header,
	journalPath,
	sessionFile,
	sessionFilePath,
} from './claude-terminal.mjs';

/**
 * The shape of a real `EnterWorktree`, captured on 2026-09-16 from a session
 * that froze the Agents row at WORKING for the rest of its life.
 *
 * The CLI changes its own working directory, rewrites `sessions/<pid>.json`
 * with the new `cwd`, and moves the journal — history included — to the
 * project directory encoded from that cwd. The session id does not change.
 * The provider used to reject every later rewrite of the session file because
 * its cwd no longer matched the process cwd captured at binding, and the
 * follower on the old journal path closed when the file moved, so nothing
 * that happened afterwards reached the host.
 */
const sessionId = '86251fa6-6751-4193-aed0-1424c66faa5d';
const WORKTREE = `${CWD}/.claude/worktrees/moderation-week37-followups`;
const WORKTREE_PROJECTS = `${HOME}/${claudeProjectDirectoryPath(WORKTREE)}`;

const startedAt = Date.parse('2026-09-06T11:00:00.000Z');
/** Records are stamped after the bind-time status so none is history. */
const at = (seconds) =>
	new Date(startedAt + 100_000 + seconds * 1000).toISOString();

const toolUse = (toolId, name, seconds) => [
	{
		type: 'assistant',
		sessionId,
		uuid: `${toolId}-use`,
		timestamp: at(seconds),
		message: {
			role: 'assistant',
			model: 'claude-fable-5-1',
			stop_reason: 'tool_use',
			content: [{ type: 'tool_use', id: toolId, name, input: {} }],
		},
	},
	{
		type: 'user',
		sessionId,
		uuid: `${toolId}-result`,
		timestamp: at(seconds + 0.5),
		message: {
			role: 'user',
			content: [{ type: 'tool_result', tool_use_id: toolId, content: 'ok' }],
		},
	},
];

/** What the journal held under the original cwd. */
const beforeMove = [
	header(sessionId),
	{ type: 'ai-title', sessionId, aiTitle: 'AI moderation artifact report' },
	{
		type: 'user',
		sessionId,
		uuid: 'prompt-1',
		timestamp: at(1),
		message: { role: 'user', content: 'open a pull request for this' },
	},
	...toolUse('toolu_before', 'ToolSearch', 2),
];
/** What the CLI appended after moving it under the worktree. */
const afterMove = [
	...toolUse('toolu_enter', 'EnterWorktree', 5),
	...toolUse('toolu_after', 'Bash', 8),
];

/**
 * The fixture applies a session-file rewrite each time the sessions directory
 * is listed, so a sequence of rewrites is a sequence of things the CLI wrote.
 * The relocated journal is present from the start because the fixture cannot
 * move a file; the provider is not told about it until the file's cwd changes.
 */
function movedTerminal(rewrites) {
	return claudeTerminal({
		sessionId,
		fileStartedAt: startedAt,
		journals: { [sessionId]: beforeMove },
		extraFiles: {
			[journalPath(sessionId, WORKTREE_PROJECTS)]: [
				...beforeMove,
				...afterMove,
			],
		},
		fileRewrites: {
			[sessionFilePath(PID)]: rewrites.map((rewrite) => [
				sessionFile({ sessionId, startedAt, ...rewrite }),
			]),
		},
	});
}

const kinds = (harness) => harness.events().map((event) => event.kind);
const toolIds = (harness) =>
	harness
		.events()
		.filter((event) => event.kind === 'tool.started')
		.map((event) => event.toolId);

test('a session that moves into a worktree keeps reporting status and activity', async () => {
	const harness = await createAgentExtensionHarness(extension);
	try {
		await harness.observe(
			movedTerminal([
				{ cwd: WORKTREE, status: 'busy', statusUpdatedAt: startedAt + 105_000 },
				{ cwd: WORKTREE, status: 'idle', statusUpdatedAt: startedAt + 120_000 },
			]),
		);
		assert.equal(harness.observation()?.state, 'bound');
		assert.ok(
			toolIds(harness).includes('toolu_after'),
			'the tool run after the move is projected from the relocated journal',
		);
		assert.equal(
			kinds(harness).at(-1),
			'agent.done',
			'the idle written after the move completes the root',
		);
		assert.equal(harness.projection().working, false);
		assert.equal(
			kinds(harness).filter((kind) => kind === 'session.started').length,
			1,
			'the relocation is the same conversation, not a new session',
		);
		assert.equal(
			harness.projection().title,
			'AI moderation artifact report',
			'the title chosen before the move stands',
		);
		assert.deepEqual(
			kinds(harness).filter((kind) => kind === 'subagent.done'),
			[],
			'nothing is cancelled by the move',
		);
	} finally {
		await harness.dispose();
	}
});

test('a status change written together with the cwd change is not lost', async () => {
	const harness = await createAgentExtensionHarness(extension);
	try {
		await harness.observe(
			movedTerminal([
				{ cwd: WORKTREE, status: 'idle', statusUpdatedAt: startedAt + 120_000 },
			]),
		);
		assert.ok(
			kinds(harness).includes('agent.done'),
			'the idle completes the root',
		);
		assert.equal(harness.projection().working, false);
		// The relocated journal replays under an idle mark that postdates every
		// record in it, so the history it carries is history: nothing in it is
		// re-opened as live after the completion.
		const done = kinds(harness).indexOf('agent.done');
		assert.deepEqual(
			kinds(harness)
				.slice(done + 1)
				.filter((kind) => kind === 'turn.started' || kind === 'tool.started'),
			[],
		);
	} finally {
		await harness.dispose();
	}
});

test('a cwd change whose journal has not moved yet keeps the status lane', async () => {
	// The session file can be rewritten before the journal appears under the
	// new project directory. The lookup by exact filename still finds the
	// journal where it is, nothing is re-followed, and the file keeps moving
	// the root.
	const harness = await createAgentExtensionHarness(extension);
	try {
		await harness.observe(
			claudeTerminal({
				sessionId,
				fileStartedAt: startedAt,
				journals: { [sessionId]: beforeMove },
				fileRewrites: {
					[sessionFilePath(PID)]: [
						[
							sessionFile({
								sessionId,
								startedAt,
								cwd: WORKTREE,
								status: 'busy',
								statusUpdatedAt: startedAt + 105_000,
							}),
						],
						[
							sessionFile({
								sessionId,
								startedAt,
								cwd: WORKTREE,
								status: 'idle',
								statusUpdatedAt: startedAt + 120_000,
							}),
						],
					],
				},
			}),
		);
		assert.equal(kinds(harness).at(-1), 'agent.done');
		assert.deepEqual(
			toolIds(harness),
			['toolu_before'],
			'the unmoved journal is not replayed a second time',
		);
	} finally {
		await harness.dispose();
	}
});

test('a session file whose cwd disagrees with the process still binds nothing', async () => {
	// The bind-time rule is untouched: cwd is identity evidence until the file
	// has bound, and data only afterwards.
	const harness = await createAgentExtensionHarness(extension);
	try {
		await harness.observe(
			claudeTerminal({
				sessionId,
				fileStartedAt: startedAt,
				fileCwd: WORKTREE,
				journals: { [sessionId]: beforeMove },
			}),
		);
		assert.equal(harness.observation()?.state, 'not-bound');
	} finally {
		await harness.dispose();
	}
});
