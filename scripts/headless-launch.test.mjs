import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const {
	applyHeadlessChromiumSwitches,
	darwinHasAquaSession,
	shouldUseHeadlessChromium,
} = await importHeadlessLaunch();

test('headless Chromium is only for macOS without an Aqua session', () => {
	assert.equal(shouldUseHeadlessChromium('darwin', false), true);
	assert.equal(shouldUseHeadlessChromium('darwin', true), false);
	assert.equal(shouldUseHeadlessChromium('linux', false), false);
});

test('Aqua probe treats launchctl failure as no console GUI session', () => {
	assert.equal(
		darwinHasAquaSession(501, () => {
			throw new Error('gui domain missing');
		}),
		false,
	);
	assert.equal(
		darwinHasAquaSession(501, () => undefined),
		true,
	);
	assert.equal(darwinHasAquaSession(Number.NaN, () => undefined), false);
});

test('headless switches disable GPU before Chromium starts', () => {
	const switches = [];
	let disabledGpu = false;
	applyHeadlessChromiumSwitches({
		disableHardwareAcceleration() {
			disabledGpu = true;
		},
		commandLine: {
			appendSwitch(name) {
				switches.push(name);
			},
		},
	});
	assert.equal(disabledGpu, true);
	assert.deepEqual(switches, ['headless', 'disable-gpu']);
});

async function importHeadlessLaunch() {
	const directory = await mkdtemp(join(tmpdir(), 'terminay-headless-launch-'));
	const outputPath = join(directory, 'headless-launch.mjs');
	try {
		await build({
			bundle: true,
			format: 'esm',
			outfile: outputPath,
			platform: 'node',
			stdin: {
				contents: `export { applyHeadlessChromiumSwitches, darwinHasAquaSession, shouldUseHeadlessChromium } from ${JSON.stringify(new URL('../electron/headlessLaunch.ts', import.meta.url).pathname)}`,
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
