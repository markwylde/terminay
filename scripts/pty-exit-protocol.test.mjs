import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const { normalizeTerminalExit } = await importProtocol();

test('normal PTY exits retain their exit code and normalize an absent signal to null', () => {
	assert.deepEqual(normalizeTerminalExit({ exitCode: 7 }), {
		exitCode: 7,
		signal: null,
	});
	assert.deepEqual(normalizeTerminalExit({ exitCode: 7, signal: 0 }), {
		exitCode: 7,
		signal: null,
	});
});

test('signal-terminated PTYs retain node-pty exit code and signal independently', () => {
	assert.deepEqual(normalizeTerminalExit({ exitCode: 0, signal: 15 }), {
		exitCode: 0,
		signal: 15,
	});
});

async function importProtocol() {
	const tempDirectory = await mkdtemp(
		join(tmpdir(), 'terminay-pty-exit-protocol-'),
	);
	const outputPath = join(tempDirectory, 'terminalExit.mjs');
	await build({
		bundle: true,
		entryPoints: [
			new URL('../src/types/terminalExit.ts', import.meta.url).pathname,
		],
		format: 'esm',
		outfile: outputPath,
		platform: 'node',
		target: 'es2022',
	});
	return import(outputPath);
}
