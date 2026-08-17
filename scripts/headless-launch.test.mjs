import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const {
	HEADLESS_CHROMIUM_SWITCHES,
	applyHeadlessChromiumSwitches,
	darwinHasAquaSession,
	headlessChromiumArgv,
	shouldUseHeadlessChromium,
} = await importHeadlessLaunch();

test('headless Chromium is only for macOS without an Aqua session', () => {
	assert.equal(shouldUseHeadlessChromium('darwin', false), true);
	assert.equal(shouldUseHeadlessChromium('darwin', true), false);
	assert.equal(shouldUseHeadlessChromium('linux', false), false);
});

test('TERMINAY_ELECTRON_HEADLESS overrides the Aqua session probe', () => {
	assert.equal(
		shouldUseHeadlessChromium('darwin', true, {
			TERMINAY_ELECTRON_HEADLESS: '1',
		}),
		true,
	);
	assert.equal(
		shouldUseHeadlessChromium('darwin', false, {
			TERMINAY_ELECTRON_HEADLESS: '0',
		}),
		false,
	);
});

test('Aqua probe requires launchctl managername Aqua', () => {
	assert.equal(
		darwinHasAquaSession(() => {
			throw new Error('launchctl missing');
		}),
		false,
	);
	assert.equal(darwinHasAquaSession(() => 'Aqua\n'), true);
	assert.equal(darwinHasAquaSession(() => 'Background\n'), false);
});

test('headless switches disable GPU and mock the keychain before Chromium starts', () => {
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
	assert.deepEqual([...HEADLESS_CHROMIUM_SWITCHES], [
		'headless',
		'disable-gpu',
		'use-mock-keychain',
	]);
	assert.deepEqual(switches, [...HEADLESS_CHROMIUM_SWITCHES]);
	assert.deepEqual(
		headlessChromiumArgv(),
		HEADLESS_CHROMIUM_SWITCHES.map((name) => `--${name}`),
	);
});

test('Electron main applies headless Chromium switches before other Electron imports', async () => {
	const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
	assert.match(main, /^import '\.\/headlessBootstrap';/u);
	assert.ok(
		main.indexOf("import './headlessBootstrap'") < main.indexOf("from 'electron'"),
	);
});

test('packaged smoke launches Chromium with the same headless argv', async () => {
	const smoke = await readFile(
		new URL('./packaged-desktop-startup-smoke.test.mjs', import.meta.url),
		'utf8',
	);
	for (const argument of headlessChromiumArgv()) {
		assert.ok(smoke.includes(argument), `packaged smoke must pass ${argument}`);
	}
	assert.match(smoke, /launchctl',\s*\['managername'\]/u);
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
				contents: `export { HEADLESS_CHROMIUM_SWITCHES, applyHeadlessChromiumSwitches, darwinHasAquaSession, headlessChromiumArgv, shouldUseHeadlessChromium } from ${JSON.stringify(new URL('../electron/headlessLaunch.ts', import.meta.url).pathname)}`,
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
