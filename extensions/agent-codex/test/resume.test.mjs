import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createAgentExtensionHarness,
	fixtureTerminal,
} from '@terminay/extension-api/testing';
import extension from '../dist/index.js';

const sessionId = 'thread-resumed-root';
const otherId = 'thread-other-root';
const startedAt = '2026-09-06T11:00:00.000Z';
const rollout = `/home/test/.codex/sessions/2026/rollout-${sessionId}.jsonl`;
const other = `/home/test/.codex/sessions/2026/rollout-${otherId}.jsonl`;

const header = (id) => ({
	type: 'session_meta',
	payload: { id, originator: 'codex-tui', source: 'cli', model: 'gpt-5.6-codex' },
});

function resumeTerminal(options) {
	return fixtureTerminal({
		foregroundExecutable: 'codex',
		cwd: '/workspace',
		startedAt,
		openFilePaths: [],
		...options,
	});
}

test('codex resume --last binds a rollout appended after process start with no writable handle', async () => {
	const harness = await createAgentExtensionHarness(extension);
	try {
		await harness.observe(
			resumeTerminal({
				arguments: ['resume', '--last'],
				files: { [rollout]: [header(sessionId)] },
				fileModifiedAt: { [rollout]: '2026-09-06T11:00:09.000Z' },
			}),
		);
		assert.equal(harness.observation()?.binding.providerSessionId, sessionId);
	} finally {
		await harness.dispose();
	}
});

test('codex resume picker binds the restored rollout after it is appended', async () => {
	const harness = await createAgentExtensionHarness(extension);
	try {
		await harness.observe(
			resumeTerminal({
				arguments: ['resume'],
				files: { [rollout]: [header(sessionId)] },
				fileModifiedAt: { [rollout]: '2026-09-06T10:00:00.000Z' },
			}),
		);
		assert.deepEqual(harness.events(), []);
		await harness.observe(
			resumeTerminal({
				arguments: ['resume'],
				files: { [rollout]: [header(sessionId)] },
				fileModifiedAt: { [rollout]: '2026-09-06T11:00:09.000Z' },
			}),
		);
		assert.equal(harness.observation()?.binding.providerSessionId, sessionId);
	} finally {
		await harness.dispose();
	}
});

test('codex resume <id> binds that id without a writable handle', async () => {
	const harness = await createAgentExtensionHarness(extension);
	try {
		await harness.observe(
			resumeTerminal({
				arguments: ['resume', sessionId],
				files: {
					[other]: [header(otherId)],
					[rollout]: [header(sessionId)],
				},
				fileModifiedAt: {
					[other]: '2026-09-06T11:00:20.000Z',
					[rollout]: '2026-09-06T11:00:09.000Z',
				},
			}),
		);
		assert.equal(harness.observation()?.binding.providerSessionId, sessionId);
	} finally {
		await harness.dispose();
	}
});

test('a normal codex launch does not bind from the sessions tree without a writable handle', async () => {
	const harness = await createAgentExtensionHarness(extension);
	try {
		await harness.observe(
			resumeTerminal({
				files: { [rollout]: [header(sessionId)] },
				fileModifiedAt: { [rollout]: '2026-09-06T11:00:09.000Z' },
			}),
		);
		assert.deepEqual(harness.events(), []);
	} finally {
		await harness.dispose();
	}
});
