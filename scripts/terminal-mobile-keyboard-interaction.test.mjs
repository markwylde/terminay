import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { LONG_PRESS_MOVE_THRESHOLD_PX } from '../src/hooks/useLongPress.ts';

const outputDirectory = await mkdtemp(
	join(tmpdir(), 'terminay-terminal-mobile-keyboard-'),
);
const outputPath = join(
	outputDirectory,
	'terminalMobileKeyboardInteraction.mjs',
);

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

test('touch focus session is limited to a trusted touch pointer or the legacy touch fallback', () => {
	assert.equal(interaction.shouldFocusTerminalForTouchPointer('touch'), true);
	assert.equal(interaction.shouldFocusTerminalForTouchPointer('mouse'), false);
	assert.equal(interaction.shouldFocusTerminalForTouchPointer('pen'), false);
	assert.equal(interaction.shouldFocusTerminalForTouchStart(true), false);
	assert.equal(interaction.shouldFocusTerminalForTouchStart(false), true);
});

test('a mobile modifier taps through one-shot, locked, and off, like iOS Shift', () => {
	const { EMPTY_TERMINAL_MOBILE_MODIFIERS: empty } = interaction;
	const once = interaction.advanceTerminalMobileModifier(empty, 'ctrl');
	const locked = interaction.advanceTerminalMobileModifier(once, 'ctrl');
	const off = interaction.advanceTerminalMobileModifier(locked, 'ctrl');

	assert.deepEqual(once, { alt: 'off', ctrl: 'once', shift: 'off' });
	assert.deepEqual(locked, { alt: 'off', ctrl: 'locked', shift: 'off' });
	assert.deepEqual(off, empty);
	assert.equal(interaction.hasTerminalMobileModifier(off), false);
	assert.equal(interaction.applyTerminalMobileModifiers('c', locked), '\x03');
});

test('an input spends a one-shot modifier and leaves a locked one on', () => {
	const { EMPTY_TERMINAL_MOBILE_MODIFIERS: empty } = interaction;
	const shiftOnce = interaction.advanceTerminalMobileModifier(empty, 'shift');
	const ctrlLocked = interaction.advanceTerminalMobileModifier(
		interaction.advanceTerminalMobileModifier(shiftOnce, 'ctrl'),
		'ctrl',
	);

	assert.deepEqual(interaction.consumeTerminalMobileModifiers(ctrlLocked), {
		alt: 'off',
		ctrl: 'locked',
		shift: 'off',
	});
	assert.deepEqual(
		interaction.consumeTerminalMobileModifiers(shiftOnce),
		empty,
	);
	let modifiers = ctrlLocked;
	const sent = [];
	for (const key of 'cd') {
		sent.push(interaction.applyTerminalMobileModifiers(key, modifiers));
		modifiers = interaction.consumeTerminalMobileModifiers(modifiers);
	}
	// Shift spent on the first key; the locked Ctrl applies to both.
	assert.deepEqual(sent, ['\x03', '\x04']);
});

test('mobile modifiers are one-shot state that derives terminal-compatible bytes', () => {
	const { EMPTY_TERMINAL_MOBILE_MODIFIERS: empty } = interaction;
	const ctrl = interaction.advanceTerminalMobileModifier(empty, 'ctrl');
	const ctrlAlt = interaction.advanceTerminalMobileModifier(ctrl, 'alt');

	assert.deepEqual(ctrl, { alt: 'off', ctrl: 'once', shift: 'off' });
	assert.equal(interaction.hasTerminalMobileModifier(empty), false);
	assert.equal(interaction.hasTerminalMobileModifier(ctrlAlt), true);
	assert.equal(interaction.applyTerminalMobileModifiers('c', ctrl), '\x03');
	assert.equal(interaction.applyTerminalMobileModifiers('[', ctrl), '\x1b');
	assert.equal(
		interaction.applyTerminalMobileModifiers('x', ctrlAlt),
		'\x1b\x18',
	);
});

test('terminal-generated reports do not consume a latched mobile modifier', () => {
	assert.equal(interaction.isTerminalMobileModifierTarget('c'), true);
	assert.equal(interaction.isTerminalMobileModifierTarget('hello '), true);
	assert.equal(interaction.isTerminalMobileModifierTarget('\x1b[I'), false);
	assert.equal(interaction.isTerminalMobileModifierTarget('\x1b[O'), false);
	assert.equal(
		interaction.isTerminalMobileModifierTarget('\x1b[<0;3;4M'),
		false,
	);
	assert.equal(interaction.isTerminalMobileModifierTarget(''), false);
});

test('mobile accessory arrows and reverse tab use xterm modifier sequences', () => {
	const { EMPTY_TERMINAL_MOBILE_MODIFIERS: empty } = interaction;
	const shift = interaction.advanceTerminalMobileModifier(empty, 'shift');
	const ctrl = interaction.advanceTerminalMobileModifier(empty, 'ctrl');
	const alt = interaction.advanceTerminalMobileModifier(empty, 'alt');

	assert.equal(
		interaction.applyTerminalMobileModifiers('\x1b[A', empty),
		'\x1b[A',
	);
	assert.equal(
		interaction.applyTerminalMobileModifiers('\x1b[A', shift),
		'\x1b[1;2A',
	);
	assert.equal(
		interaction.applyTerminalMobileModifiers('\x1b[B', ctrl),
		'\x1b[1;5B',
	);
	assert.equal(
		interaction.applyTerminalMobileModifiers('\x1b[C', alt),
		'\x1b[1;3C',
	);
	assert.equal(interaction.applyTerminalMobileModifiers('\t', shift), '\x1b[Z');
});

const tapDown = { clientX: 10, clientY: 20, pointerId: 1 };
const tapSessionOptions = { moveThresholdPx: LONG_PRESS_MOVE_THRESHOLD_PX };

test('tap session module type-checks with no DOM references', async () => {
	const source = await readFile(
		'src/components/terminalMobileKeyboardInteraction.ts',
		'utf8',
	);
	assert.doesNotMatch(
		source,
		/\bdocument\b|\bwindow\b|\bHTMLElement\b|\bHTML\w+Element\b|\bPointerEvent\b|\bTouchEvent\b/u,
	);
});

test('tap session reuses the established tap-versus-drag movement threshold', async () => {
	assert.equal(tapSessionOptions.moveThresholdPx, LONG_PRESS_MOVE_THRESHOLD_PX);
	const panelSource = await readFile(
		'src/components/TerminalPanel.tsx',
		'utf8',
	);
	assert.match(
		panelSource,
		/createTerminalTapSession\(\{\s*moveThresholdPx: LONG_PRESS_MOVE_THRESHOLD_PX/u,
	);
	const session = interaction.createTerminalTapSession(tapSessionOptions);
	session.pointerDown(tapDown);
	session.pointerMove({
		clientX: tapDown.clientX + LONG_PRESS_MOVE_THRESHOLD_PX - 1,
		clientY: tapDown.clientY,
		pointerId: tapDown.pointerId,
	});
	assert.equal(session.pointerUp({ pointerId: tapDown.pointerId }), true);

	session.pointerDown(tapDown);
	session.pointerMove({
		clientX: tapDown.clientX + LONG_PRESS_MOVE_THRESHOLD_PX,
		clientY: tapDown.clientY,
		pointerId: tapDown.pointerId,
	});
	assert.equal(session.pointerUp({ pointerId: tapDown.pointerId }), false);
});

test('a still release claims focus, a moved or cancelled pointer does not', () => {
	const session = interaction.createTerminalTapSession(tapSessionOptions);
	session.pointerDown(tapDown);
	assert.equal(session.pointerUp({ pointerId: tapDown.pointerId }), true);

	session.pointerDown(tapDown);
	session.pointerMove({
		clientX: tapDown.clientX + LONG_PRESS_MOVE_THRESHOLD_PX + 4,
		clientY: tapDown.clientY,
		pointerId: tapDown.pointerId,
	});
	assert.equal(session.pointerUp({ pointerId: tapDown.pointerId }), false);

	session.pointerDown(tapDown);
	session.pointerCancel({ pointerId: tapDown.pointerId });
	assert.equal(session.pointerUp({ pointerId: tapDown.pointerId }), false);
});

test('a second pointer arriving mid-gesture neither claims focus nor disturbs the tracked pointer', () => {
	const session = interaction.createTerminalTapSession(tapSessionOptions);
	session.pointerDown(tapDown);
	session.pointerDown({ clientX: 80, clientY: 90, pointerId: 2 });
	session.pointerMove({
		clientX: tapDown.clientX + LONG_PRESS_MOVE_THRESHOLD_PX + 20,
		clientY: tapDown.clientY,
		pointerId: 2,
	});
	assert.equal(session.pointerUp({ pointerId: 2 }), false);
	assert.equal(session.pointerUp({ pointerId: tapDown.pointerId }), true);
});

test('a slow still release claims focus rather than being treated as a scroll', () => {
	const session = interaction.createTerminalTapSession(tapSessionOptions);
	session.pointerDown(tapDown);
	assert.equal(session.pointerUp({ pointerId: tapDown.pointerId }), true);
});

test('focus is claimed once per accepted tap and not for a scroll gesture', () => {
	const session = interaction.createTerminalTapSession(tapSessionOptions);
	let claims = 0;
	const claimIfReleased = (pointerId) => {
		if (session.pointerUp({ pointerId })) claims += 1;
	};

	session.pointerDown(tapDown);
	claimIfReleased(tapDown.pointerId);
	session.pointerDown(tapDown);
	session.pointerMove({
		clientX: tapDown.clientX + LONG_PRESS_MOVE_THRESHOLD_PX + 12,
		clientY: tapDown.clientY,
		pointerId: tapDown.pointerId,
	});
	claimIfReleased(tapDown.pointerId);
	assert.equal(claims, 1);
});
