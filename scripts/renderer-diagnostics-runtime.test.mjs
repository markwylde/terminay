import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const outputDirectory = await mkdtemp(
	join(process.cwd(), 'scripts', '.renderer-diagnostics-'),
);
await build({
	absWorkingDir: process.cwd(),
	bundle: true,
	entryPoints: ['src/shared/rendererDiagnostics.ts'],
	format: 'esm',
	outdir: outputDirectory,
	platform: 'browser',
});
const diagnostics = await import(
	pathToFileURL(join(outputDirectory, 'rendererDiagnostics.js')).href
);
test.after(async () => {
	delete globalThis.__terminayRendererDiagnostic;
	await rm(outputDirectory, { recursive: true, force: true });
});

test('publishes frozen bounded observations without a privileged host', () => {
	const observed = [];
	globalThis.__terminayRendererDiagnostic = (value) => observed.push(value);
	diagnostics.recordBootstrapDiagnostic('workspace.snapshot.received', 2);
	diagnostics.recordBootstrapDiagnostic('x'.repeat(129), 3);
	diagnostics.recordRendererDiagnostic({
		kind: 'terminal-recovery',
		phase: 'recovered',
		attempt: 2,
		durationMs: 25,
	});
	assert.equal(observed.length, 2);
	assert.deepEqual(observed[0], {
		kind: 'bootstrap',
		phase: 'workspace.snapshot.received',
		count: 2,
	});
	assert.equal(Object.isFrozen(observed[0]), true);
	assert.equal(Object.isFrozen(observed[1]), true);
});

test('observer failure cannot escape into production behavior', () => {
	globalThis.__terminayRendererDiagnostic = () => {
		throw new Error('observer failed');
	};
	assert.doesNotThrow(() =>
		diagnostics.recordBootstrapDiagnostic('app.render'),
	);
});
