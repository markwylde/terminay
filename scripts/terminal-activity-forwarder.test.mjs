import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const { forwardTerminalDataAfterSignals } = await importForwarder();

test('semantic signal delivery precedes raw terminal output for the same chunk', () => {
	const delivered = [];
	const writer = {
		write(data, callback) {
			delivered.push(`signal:${data}`);
			callback?.();
		},
	};

	forwardTerminalDataAfterSignals(writer, 'chunk', (data) => {
		delivered.push(`data:${data}`);
	});

	assert.deepEqual(delivered, ['signal:chunk', 'data:chunk']);
});

test('raw terminal output still forwards when signal detection is unavailable', () => {
	const delivered = [];
	forwardTerminalDataAfterSignals(null, 'chunk', (data) => {
		delivered.push(data);
	});
	assert.deepEqual(delivered, ['chunk']);
});

async function importForwarder() {
	const tempDir = await mkdtemp(
		join(tmpdir(), 'terminay-terminal-activity-forwarder-'),
	);
	const outputPath = join(tempDir, 'forwarder.mjs');
	await build({
		bundle: true,
		entryPoints: [
			new URL('../electron/terminalActivityForwarder.ts', import.meta.url)
				.pathname,
		],
		format: 'esm',
		outfile: outputPath,
		platform: 'node',
		target: 'es2022',
	});
	return import(outputPath);
}
