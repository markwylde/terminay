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

test('mobile modifiers are one-shot state that derives terminal-compatible bytes', () => {
	const { EMPTY_TERMINAL_MOBILE_MODIFIERS: empty } = interaction;
	const ctrl = interaction.toggleTerminalMobileModifier(empty, 'ctrl');
	const ctrlAlt = interaction.toggleTerminalMobileModifier(ctrl, 'alt');

	assert.deepEqual(ctrl, { alt: false, ctrl: true, shift: false });
	assert.equal(interaction.hasTerminalMobileModifier(empty), false);
	assert.equal(interaction.hasTerminalMobileModifier(ctrlAlt), true);
	assert.equal(interaction.applyTerminalMobileModifiers('c', ctrl), '\x03');
	assert.equal(interaction.applyTerminalMobileModifiers('[', ctrl), '\x1b');
	assert.equal(
		interaction.applyTerminalMobileModifiers('x', ctrlAlt),
		'\x1b\x18',
	);
});

test('mobile accessory arrows and reverse tab use xterm modifier sequences', () => {
	const { EMPTY_TERMINAL_MOBILE_MODIFIERS: empty } = interaction;
	const shift = interaction.toggleTerminalMobileModifier(empty, 'shift');
	const ctrl = interaction.toggleTerminalMobileModifier(empty, 'ctrl');
	const alt = interaction.toggleTerminalMobileModifier(empty, 'alt');

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
