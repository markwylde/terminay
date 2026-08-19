import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const outputDirectory = await mkdtemp(
	join(tmpdir(), 'terminay-terminal-focus-interaction-'),
);
const outputPath = join(outputDirectory, 'terminalFocusInteraction.mjs');

await build({
	bundle: true,
	entryPoints: ['src/components/terminalFocusInteraction.ts'],
	format: 'esm',
	outfile: outputPath,
	platform: 'node',
});

const {
	shouldClaimCreatedTerminalFocus,
	shouldRestoreTerminalFocusAfterWindowActivation,
} = await import(pathToFileURL(outputPath).href);
const terminalPanelSource = await readFile(
	'src/components/TerminalPanel.tsx',
	'utf8',
);

test.after(async () => {
	await rm(outputDirectory, { force: true, recursive: true });
});

test('window activation restores only the terminal clicked in the fresh activation window', () => {
	assert.equal(
		shouldRestoreTerminalFocusAfterWindowActivation(1_000, 1_000),
		true,
	);
	assert.equal(
		shouldRestoreTerminalFocusAfterWindowActivation(1_000, 1_599),
		true,
	);
	assert.equal(
		shouldRestoreTerminalFocusAfterWindowActivation(1_000, 1_600),
		false,
	);
});

test('stale, future, malformed, and non-positive activation windows cannot steal split-terminal focus', () => {
	assert.equal(
		shouldRestoreTerminalFocusAfterWindowActivation(1_000, 999),
		false,
	);
	assert.equal(
		shouldRestoreTerminalFocusAfterWindowActivation(1_000, 1_601),
		false,
	);
	assert.equal(
		shouldRestoreTerminalFocusAfterWindowActivation(Number.NaN, 1_000),
		false,
	);
	assert.equal(
		shouldRestoreTerminalFocusAfterWindowActivation(1_000, Infinity),
		false,
	);
	assert.equal(
		shouldRestoreTerminalFocusAfterWindowActivation(1_000, 1_001, 0),
		false,
	);
});

test('terminal pointerdown leaves xterm focus and selection handling alone', () => {
	assert.doesNotMatch(terminalPanelSource, /activatePanelFromPointer/u);
	assert.doesNotMatch(
		terminalPanelSource,
		/root\.addEventListener\('pointerdown', [^)]*focus/u,
	);
	assert.doesNotMatch(
		terminalPanelSource,
		/root\.addEventListener\('pointerdown', [^)]*setActive/u,
	);
	assert.doesNotMatch(
		terminalPanelSource,
		/root\.addEventListener\('pointerdown', activatePanelFromPointer\)/u,
	);
	assert.doesNotMatch(terminalPanelSource, /pointerFocusGesture/u);
});

test('created terminals reclaim focus from project and terminal creation chrome', () => {
	assert.equal(shouldClaimCreatedTerminalFocus(null), true);
	assert.equal(shouldClaimCreatedTerminalFocus({ nodeName: 'BODY' }), true);
	assert.equal(
		shouldClaimCreatedTerminalFocus({
			nodeName: 'BUTTON',
			closest: (selector) =>
				selector.includes('terminay-add-tab-button') ? {} : null,
		}),
		true,
	);
	assert.equal(
		shouldClaimCreatedTerminalFocus({
			nodeName: 'BUTTON',
			closest: (selector) => (selector.includes('project-tab-add') ? {} : null),
		}),
		true,
	);
	assert.equal(
		shouldClaimCreatedTerminalFocus({
			nodeName: 'INPUT',
			closest: () => null,
		}),
		false,
	);
	assert.match(
		terminalPanelSource,
		/shouldClaimCreatedTerminalFocus\(activeElement\)/u,
	);
});
