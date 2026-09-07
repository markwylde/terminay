import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createAgentExtensionHarness,
	fixtureTerminal,
} from '@terminay/extension-api/testing';
import extension from '../dist/index.js';
import {
	claudeTerminal,
	header,
	PID,
	sessionFile,
	sessionFilePath,
	titled,
} from './claude-terminal.mjs';

const sessionId = '5f2aff08-eab3-4852-96eb-48235fc7f471';
const other = 'bf0b34e1-4afc-4b93-8389-80caa0b589a4';
const projects = '/home/test/.claude/projects/-workspace';
const startedAt = '2026-09-06T11:00:00.000Z';

async function observe(terminal) {
	const harness = await createAgentExtensionHarness(extension);
	try {
		await harness.observe(terminal);
		return {
			events: harness.events(),
			state: harness.observation()?.state,
			sessionId: harness.observation()?.binding?.providerSessionId,
		};
	} finally {
		await harness.dispose();
	}
}

test('binds the journal its session file names, holding no writable handle', async () => {
	const result = await observe(
		claudeTerminal({
			sessionId,
			journals: { [sessionId]: [header(sessionId)] },
		}),
	);
	assert.deepEqual(result.events, [
		{ kind: 'session.started', title: 'Claude Code' },
	]);
	assert.equal(result.sessionId, sessionId);
});

test('a journal older than the process binds, because the file is the evidence', async () => {
	// `claude --resume` and `--continue` append to a journal an earlier process
	// created; its age says nothing about which process holds it now.
	const result = await observe(
		claudeTerminal({
			sessionId,
			journals: { [sessionId]: [header(sessionId)] },
			older: [sessionId],
		}),
	);
	assert.equal(result.sessionId, sessionId);
});

test('a journal with no recorded creation or modification time still binds', async () => {
	const result = await observe(
		fixtureTerminal({
			foregroundExecutable: 'claude',
			cwd: '/workspace',
			pid: PID,
			startedAt,
			openFilePaths: [],
			files: {
				[`${projects}/${sessionId}.jsonl`]: [header(sessionId)],
				[sessionFilePath(PID)]: [
					sessionFile({ sessionId, startedAt: Date.parse(startedAt) }),
				],
			},
		}),
	);
	assert.equal(result.sessionId, sessionId);
});

test('an open writable handle on another journal is never consulted', async () => {
	const result = await observe(
		claudeTerminal({
			sessionId,
			journals: {
				[sessionId]: [header(sessionId)],
				[other]: [header(other)],
			},
			openFilePaths: [`${projects}/${other}.jsonl`],
		}),
	);
	assert.equal(result.sessionId, sessionId);
});

test('one process with several conversations binds only the one it currently names', async () => {
	// Taken from a live host: one `claude` process that has written two root
	// journals over its lifetime. Its session file names the live one.
	const result = await observe(
		claudeTerminal({
			sessionId,
			journals: {
				[sessionId]: titled(sessionId, 'Live conversation'),
				[other]: titled(other, 'Earlier conversation'),
			},
			older: [other],
			appendedLast: other,
		}),
	);
	assert.deepEqual(result.events, [
		{ kind: 'session.started', title: 'Claude Code' },
		{ kind: 'agent.metadata', title: 'Live conversation' },
	]);
});

test('a sidechain journal is never an eligible root', async () => {
	const result = await observe(
		claudeTerminal({
			sessionId,
			journals: {
				[sessionId]: [{ ...header(sessionId), isSidechain: true }],
			},
		}),
	);
	assert.equal(result.state, 'not-bound');
	assert.deepEqual(result.events, []);
});

test('a subagents journal below the root session is not a root candidate', async () => {
	const child = `${projects}/${sessionId}/subagents/agent-a94c3c95918d29dc8.jsonl`;
	const result = await observe(
		claudeTerminal({
			sessionId,
			extraFiles: {
				[child]: [
					{
						...header(sessionId),
						isSidechain: true,
						agentId: 'a94c3c95918d29dc8',
					},
				],
			},
		}),
	);
	assert.equal(result.state, 'not-bound');
	assert.deepEqual(result.events, []);
});

test('a process whose start time the environment cannot prove still binds', async () => {
	// The tolerance check applies only where a start time is reported. Without
	// one the pid, cwd and session id checks stand alone.
	const result = await observe(
		fixtureTerminal({
			foregroundExecutable: 'claude',
			cwd: '/workspace',
			pid: PID,
			openFilePaths: [],
			files: {
				[`${projects}/${sessionId}.jsonl`]: [header(sessionId)],
				[sessionFilePath(PID)]: [
					sessionFile({ sessionId, startedAt: Date.parse(startedAt) }),
				],
			},
		}),
	);
	assert.equal(result.sessionId, sessionId);
});

test('a process the environment reports no pid for binds nothing', async () => {
	const result = await observe(
		claudeTerminal({
			sessionId,
			journals: { [sessionId]: [header(sessionId)] },
			// The fixture reports the pid it was given; naming a different one in
			// the file is the same evidence gap as reporting none at all.
			sessionFileRecord: sessionFile({
				pid: 0,
				sessionId,
				startedAt: Date.parse(startedAt),
			}),
		}),
	);
	assert.equal(result.state, 'not-bound');
});

test('a journal in another project directory is not admitted', async () => {
	const elsewhere = `/home/test/.claude/projects/-other/${sessionId}.jsonl`;
	const result = await observe(
		claudeTerminal({
			sessionId,
			extraFiles: { [elsewhere]: [header(sessionId)] },
		}),
	);
	assert.equal(result.state, 'not-bound');
	assert.deepEqual(result.events, []);
});

test('a journal written after a first unbound observation binds on the next one', async () => {
	// The host retries `not-bound` through its discovery window and then keeps
	// discovery armed by topology polling, so a `claude` process observed before
	// it has written its journal binds on a later sample rather than on the next
	// foreground change. The provider stays a single bounded sample.
	const harness = await createAgentExtensionHarness(extension);
	try {
		await harness.observe(claudeTerminal({ sessionId }));
		assert.deepEqual(harness.events(), [], 'no journal yet, so nothing binds');
		await harness.observe(
			claudeTerminal({
				sessionId,
				journals: { [sessionId]: [header(sessionId)] },
			}),
		);
		assert.deepEqual(harness.events(), [
			{ kind: 'session.started', title: 'Claude Code' },
		]);
	} finally {
		await harness.dispose();
	}
});

test('a session file written after a first unbound observation binds on the next one', async () => {
	const harness = await createAgentExtensionHarness(extension);
	try {
		await harness.observe(
			claudeTerminal({
				sessionId,
				omitSessionFile: true,
				journals: { [sessionId]: [header(sessionId)] },
			}),
		);
		assert.deepEqual(harness.events(), [], 'no session file yet');
		await harness.observe(
			claudeTerminal({
				sessionId,
				journals: { [sessionId]: [header(sessionId)] },
			}),
		);
		assert.deepEqual(harness.events(), [
			{ kind: 'session.started', title: 'Claude Code' },
		]);
	} finally {
		await harness.dispose();
	}
});
