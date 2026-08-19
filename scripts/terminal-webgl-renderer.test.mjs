import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const outputDirectory = await mkdtemp(
	join(tmpdir(), 'terminay-terminal-webgl-renderer-'),
);
const outputPath = join(outputDirectory, 'terminalWebglRenderer.mjs');

await build({
	bundle: true,
	entryPoints: ['src/components/terminalWebglRenderer.ts'],
	format: 'esm',
	outfile: outputPath,
	platform: 'node',
});

const { attachTerminalWebglRenderer, liveTerminalWebglRendererEnabled } =
	await import(pathToFileURL(outputPath).href);
const [
	helperSource,
	panelSource,
	settingsSource,
	recordingsSource,
	checkpointSource,
] = await Promise.all([
	readFile('src/components/terminalWebglRenderer.ts', 'utf8'),
	readFile('src/components/TerminalPanel.tsx', 'utf8'),
	readFile('src/components/SettingsWindow.tsx', 'utf8'),
	readFile('src/components/RecordingsWindow.tsx', 'utf8'),
	readFile(
		'packages/server-core/src/terminalService/presentationCheckpoint.ts',
		'utf8',
	),
]);

test.after(async () => {
	await rm(outputDirectory, { recursive: true, force: true });
});

function createHarness({ failCreate = false, failLoad = false } = {}) {
	const events = [];
	let contextLoss;

	const createAddon = () => {
		if (failCreate) throw new Error('WebGL unavailable');
		events.push('create');
		return {
			activate() {},
			dispose() {
				events.push('dispose');
			},
			onContextLoss(listener) {
				events.push('subscribe-loss');
				contextLoss = listener;
				return {
					dispose() {
						events.push('unsubscribe-loss');
						contextLoss = undefined;
					},
				};
			},
		};
	};

	return {
		events,
		loseContext() {
			contextLoss?.();
		},
		createAddon,
		terminal: {
			loadAddon(addon) {
				if (failLoad) throw new Error('renderer rejected');
				events.push(`load:${typeof addon.dispose}`);
			},
		},
	};
}

test('automated driver sessions keep the DOM renderer', () => {
	assert.equal(liveTerminalWebglRendererEnabled(), true);
	assert.equal(
		liveTerminalWebglRendererEnabled({ webdriver: true }),
		false,
	);
	assert.equal(
		liveTerminalWebglRendererEnabled({ automatedSession: true }),
		false,
	);

	const skipped = createHarness();
	assert.equal(
		attachTerminalWebglRenderer(
			skipped.terminal,
			skipped.createAddon,
			{ enabled: false },
		).attached,
		false,
	);
	assert.deepEqual(skipped.events, []);
});

test('WebGL attach loads the addon and falls back when construction or load fails', () => {
	const attached = createHarness();
	const result = attachTerminalWebglRenderer(
		attached.terminal,
		attached.createAddon,
	);
	assert.equal(result.attached, true);
	assert.deepEqual(attached.events, [
		'create',
		'load:function',
		'subscribe-loss',
	]);

	const createFailed = createHarness({ failCreate: true });
	assert.equal(
		attachTerminalWebglRenderer(createFailed.terminal, createFailed.createAddon)
			.attached,
		false,
	);
	assert.deepEqual(createFailed.events, []);

	const loadFailed = createHarness({ failLoad: true });
	assert.equal(
		attachTerminalWebglRenderer(loadFailed.terminal, loadFailed.createAddon)
			.attached,
		false,
	);
	assert.deepEqual(loadFailed.events, ['create', 'dispose']);
});

test('a lost GPU context disposes the addon once so the DOM renderer can resume', () => {
	const harness = createHarness();
	const result = attachTerminalWebglRenderer(
		harness.terminal,
		harness.createAddon,
	);
	harness.loseContext();
	result.dispose();
	harness.loseContext();
	assert.deepEqual(harness.events, [
		'create',
		'load:function',
		'subscribe-loss',
		'unsubscribe-loss',
		'dispose',
	]);
});

test('live xterm surfaces attach WebGL after open and headless xterm never does', () => {
	for (const source of [panelSource, settingsSource, recordingsSource]) {
		assert.match(
			source,
			/terminal\.open\(root\)[\s\S]*attachTerminalWebglRenderer\(\s*terminal,\s*\(\) => new WebglAddon\(\)/u,
		);
	}

	assert.doesNotMatch(
		checkpointSource,
		/addon-webgl|WebglAddon|attachTerminalWebglRenderer/u,
	);
});

test('WebGL attach policy remains transport-neutral', () => {
	assert.doesNotMatch(
		helperSource,
		/window\.terminay|TerminalPanelAttachment|\.write\(|\.resize\(/u,
	);
	assert.match(
		helperSource,
		/options\?\.enabled \?\? liveTerminalWebglRendererEnabled\(\)/u,
	);
	assert.match(helperSource, /navigator\.webdriver === true/u);
	assert.match(helperSource, /terminayLocalConnectionFaultTest/u);
});
