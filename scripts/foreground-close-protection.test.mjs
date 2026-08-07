import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const { getRunningTerminalSessionIds } = await importCloseProtection();

const session = (sessionId, projectId, foregroundBusy) => ({
	sessionId,
	projectId,
	foregroundBusy,
	status: foregroundBusy ? 'working' : 'idle',
	attention: false,
	acknowledged: true,
	claimed: false,
	authority: 'structured',
	source: 'structured:foreground',
	updatedAt: 1,
});

test('close protection selects only real foreground work and scopes projects', () => {
	const snapshot = {
		revision: 1,
		cursor: '1',
		sessions: {
			busyA: session('busyA', 'project-a', true),
			idleA: session('idleA', 'project-a', false),
			busyB: session('busyB', 'project-b', true),
		},
	};
	assert.deepEqual(getRunningTerminalSessionIds(snapshot), ['busyA', 'busyB']);
	assert.deepEqual(getRunningTerminalSessionIds(snapshot, 'project-a'), [
		'busyA',
	]);
});

test('presentation working state cannot create a close warning', () => {
	const snapshot = {
		revision: 1,
		cursor: '1',
		sessions: {
			outputOnly: {
				...session('outputOnly', 'project-a', false),
				status: 'working',
			},
		},
	};
	assert.deepEqual(getRunningTerminalSessionIds(snapshot), []);
});

async function importCloseProtection() {
	const directory = await mkdtemp(join(tmpdir(), 'terminay-close-protection-'));
	const outputPath = join(directory, 'close-protection.mjs');
	try {
		await build({
			bundle: true,
			format: 'esm',
			outfile: outputPath,
			platform: 'node',
			stdin: {
				contents: `export { getRunningTerminalSessionIds } from ${JSON.stringify(new URL('../src/workspace/closeProtection.ts', import.meta.url).pathname)}`,
				loader: 'ts',
				resolveDir: process.cwd(),
			},
			target: 'node24',
		});
		return await import(outputPath);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
