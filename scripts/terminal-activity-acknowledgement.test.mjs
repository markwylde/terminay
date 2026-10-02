import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const { shouldAcknowledgeInteractedActivity } = await importAcknowledgement();

test('project activation without interaction does not acknowledge finished work', () => {
	assert.equal(
		shouldAcknowledgeInteractedActivity({
			acknowledged: false,
			focusedSessionId: 'terminal-1',
			interactedSessionId: null,
			sessionId: 'terminal-1',
			status: 'idle',
		}),
		false,
	);
});

test('clicking or typing in a finished terminal acknowledges it', () => {
	assert.equal(
		shouldAcknowledgeInteractedActivity({
			acknowledged: false,
			focusedSessionId: 'terminal-1',
			interactedSessionId: 'terminal-1',
			sessionId: 'terminal-1',
			status: 'idle',
		}),
		true,
	);
});

test('working stays live even while the user is in the terminal', () => {
	assert.equal(
		shouldAcknowledgeInteractedActivity({
			acknowledged: false,
			focusedSessionId: 'terminal-1',
			interactedSessionId: 'terminal-1',
			sessionId: 'terminal-1',
			status: 'working',
		}),
		false,
	);
});

test('a terminal typed in earlier is not acknowledged once focus has moved on', () => {
	assert.equal(
		shouldAcknowledgeInteractedActivity({
			acknowledged: false,
			focusedSessionId: 'terminal-2',
			interactedSessionId: 'terminal-1',
			sessionId: 'terminal-1',
			status: 'idle',
		}),
		false,
	);
});

async function importAcknowledgement() {
	const tempDir = await mkdtemp(
		join(tmpdir(), 'terminay-activity-acknowledgement-'),
	);
	const outputPath = join(tempDir, 'acknowledgement.mjs');
	await build({
		bundle: true,
		entryPoints: [
			new URL(
				'../src/workspace/terminalActivityAcknowledgement.ts',
				import.meta.url,
			).pathname,
		],
		format: 'esm',
		outfile: outputPath,
		platform: 'neutral',
		target: 'es2022',
	});
	return import(outputPath);
}
