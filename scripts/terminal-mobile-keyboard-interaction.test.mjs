import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const outputDirectory = await mkdtemp(
	join(tmpdir(), 'terminay-terminal-mobile-keyboard-'),
);
const outputPath = join(outputDirectory, 'terminalMobileKeyboardInteraction.mjs');

await build({
	bundle: true,
	entryPoints: ['src/components/terminalMobileKeyboardInteraction.ts'],
	format: 'esm',
	outfile: outputPath,
	platform: 'node',
});

const interaction = await import(pathToFileURL(outputPath).href);

test.after(async () => {
	await rm(outputDirectory, { force: true, recursive: true });
});

test('touch focus bridge is limited to a trusted touch pointer or the legacy touchstart fallback', () => {
	assert.equal(interaction.shouldFocusTerminalForTouchPointer('touch'), true);
	assert.equal(interaction.shouldFocusTerminalForTouchPointer('mouse'), false);
	assert.equal(interaction.shouldFocusTerminalForTouchPointer('pen'), false);
	assert.equal(interaction.shouldFocusTerminalForTouchStart(true), false);
	assert.equal(interaction.shouldFocusTerminalForTouchStart(false), true);
});

test('mobile modifiers are one-shot state that derives terminal-compatible bytes', () => {
	const { EMPTY_TERMINAL_MOBILE_MODIFIERS: empty } = interaction;
	const ctrl = interaction.toggleTerminalMobileModifier(empty, 'ctrl');
	const ctrlAlt = interaction.toggleTerminalMobileModifier(ctrl, 'alt');

	assert.deepEqual(ctrl, { alt: false, ctrl: true, shift: false });
	assert.equal(interaction.hasTerminalMobileModifier(empty), false);
	assert.equal(interaction.hasTerminalMobileModifier(ctrlAlt), true);
	assert.equal(interaction.applyTerminalMobileModifiers('c', ctrl), '\x03');
	assert.equal(interaction.applyTerminalMobileModifiers('[', ctrl), '\x1b');
	assert.equal(interaction.applyTerminalMobileModifiers('x', ctrlAlt), '\x1b\x18');
});

test('mobile accessory arrows and reverse tab use xterm modifier sequences', () => {
	const { EMPTY_TERMINAL_MOBILE_MODIFIERS: empty } = interaction;
	const shift = interaction.toggleTerminalMobileModifier(empty, 'shift');
	const ctrl = interaction.toggleTerminalMobileModifier(empty, 'ctrl');
	const alt = interaction.toggleTerminalMobileModifier(empty, 'alt');

	assert.equal(interaction.applyTerminalMobileModifiers('\x1b[A', empty), '\x1b[A');
	assert.equal(interaction.applyTerminalMobileModifiers('\x1b[A', shift), '\x1b[1;2A');
	assert.equal(interaction.applyTerminalMobileModifiers('\x1b[B', ctrl), '\x1b[1;5B');
	assert.equal(interaction.applyTerminalMobileModifiers('\x1b[C', alt), '\x1b[1;3C');
	assert.equal(interaction.applyTerminalMobileModifiers('\t', shift), '\x1b[Z');
});
