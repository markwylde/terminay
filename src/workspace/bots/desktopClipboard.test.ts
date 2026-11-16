import assert from 'node:assert/strict';
import test from 'node:test';
import {
	attachDesktopClipboard,
	type ClipboardRfb,
	clipboardTextForHost,
	DESKTOP_CLIPBOARD_BYTES,
	mayWriteHostClipboard,
	pasteChordKeys,
	pasteShortcut,
	pasteTextFits,
	type ShortcutEvent,
} from './desktopClipboard.ts';

const Control_L = 0xffe3,
	Control_R = 0xffe4,
	Alt_L = 0xffe9,
	Super_L = 0xffeb,
	Insert = 0xff63,
	v = 0x76;

const key = (
	code: string,
	mods: Partial<ShortcutEvent> = {},
): ShortcutEvent => ({
	code,
	key: code === 'KeyV' ? 'v' : code,
	ctrlKey: false,
	shiftKey: false,
	altKey: false,
	metaKey: false,
	...mods,
});

test('paste shortcuts map to Linux chords per platform', () => {
	assert.equal(pasteShortcut(key('KeyV', { ctrlKey: true }), false), 'ctrl+v');
	assert.equal(
		pasteShortcut(key('KeyV', { ctrlKey: true, shiftKey: true }), false),
		'ctrl+shift+v',
	);
	assert.equal(
		pasteShortcut(key('Insert', { shiftKey: true }), false),
		'shift+insert',
	);
	assert.equal(pasteShortcut(key('KeyV', { metaKey: true }), true), 'ctrl+v');
	assert.equal(
		pasteShortcut(key('KeyV', { metaKey: true, shiftKey: true }), true),
		'ctrl+shift+v',
	);
	// Not paste shortcuts.
	assert.equal(pasteShortcut(key('KeyV', { ctrlKey: true }), true), null);
	assert.equal(pasteShortcut(key('KeyV', { metaKey: true }), false), null);
	assert.equal(pasteShortcut(key('KeyV'), false), null);
	assert.equal(pasteShortcut(key('KeyC', { ctrlKey: true }), false), null);
	assert.equal(
		pasteShortcut(key('KeyV', { ctrlKey: true, altKey: true }), false),
		null,
	);
	assert.equal(
		pasteShortcut(key('Insert', { shiftKey: true, ctrlKey: true }), false),
		null,
	);
	assert.equal(pasteShortcut(key('Insert', { shiftKey: true }), true), null);
});

test('macOS chords release whichever Cmd noVNC holds and restore it after', () => {
	assert.deepEqual(pasteChordKeys('ctrl+v', ['MetaLeft'], true), [
		{ keysym: Alt_L, code: 'MetaLeft', down: false },
		{ keysym: Control_L, code: 'ControlLeft', down: true },
		{ keysym: v, code: 'KeyV', down: true },
		{ keysym: v, code: 'KeyV', down: false },
		{ keysym: Control_L, code: 'ControlLeft', down: false },
		{ keysym: Alt_L, code: 'MetaLeft', down: true },
	]);
	const right = pasteChordKeys(
		'ctrl+shift+v',
		['MetaRight', 'ShiftLeft'],
		true,
	);
	assert.deepEqual(right[0], {
		keysym: Super_L,
		code: 'MetaRight',
		down: false,
	});
	assert.deepEqual(right.at(-1), {
		keysym: Super_L,
		code: 'MetaRight',
		down: true,
	});
	// Shift is the user's own, already held in the bot: never touched.
	assert.equal(
		right.some((s) => s.code.startsWith('Shift')),
		false,
	);
});

test('Ctrl chords never depend on noVNC having sent the held Ctrl', () => {
	for (const [held, keysym] of [
		[[], undefined],
		[['ControlLeft'], Control_L],
		[['ControlRight'], Control_R],
	] as const) {
		const steps = pasteChordKeys('ctrl+v', held, false);
		const core = held.length === 0 ? steps : steps.slice(1, -1);
		assert.deepEqual(core, [
			{ keysym: Control_L, code: 'ControlLeft', down: true },
			{ keysym: v, code: 'KeyV', down: true },
			{ keysym: v, code: 'KeyV', down: false },
			{ keysym: Control_L, code: 'ControlLeft', down: false },
		]);
		if (keysym !== undefined) {
			assert.deepEqual(steps[0], { keysym, code: held[0], down: false });
			assert.deepEqual(steps.at(-1), { keysym, code: held[0], down: true });
		}
	}
	assert.deepEqual(pasteChordKeys('shift+insert', ['ShiftLeft'], false), [
		{ keysym: Insert, code: 'Insert', down: true },
		{ keysym: Insert, code: 'Insert', down: false },
	]);
});

test('paste size counts UTF-8, CRLF line endings and the trailing NUL', () => {
	assert.equal(pasteTextFits('café ✓'), true);
	assert.equal(pasteTextFits('a'.repeat(DESKTOP_CLIPBOARD_BYTES - 1)), true);
	assert.equal(pasteTextFits('a'.repeat(DESKTOP_CLIPBOARD_BYTES)), false);
	// Each \n becomes \r\n.
	const half = DESKTOP_CLIPBOARD_BYTES / 2;
	assert.equal(pasteTextFits('\n'.repeat(half - 1)), true);
	assert.equal(pasteTextFits('\n'.repeat(half)), false);
	// ✓ is three UTF-8 bytes.
	const third = Math.floor((DESKTOP_CLIPBOARD_BYTES - 1) / 3);
	assert.equal(pasteTextFits('✓'.repeat(third)), true);
	assert.equal(pasteTextFits('✓'.repeat(third + 1)), false);
});

test('bot text reaches the host only when bounded, non-empty and free of controls', () => {
	assert.equal(clipboardTextForHost('café ✓\tx\r\ny'), 'café ✓\tx\r\ny');
	assert.equal(clipboardTextForHost(''), undefined);
	assert.equal(clipboardTextForHost(undefined), undefined);
	assert.equal(clipboardTextForHost('rm -rf \u001b[31m'), undefined);
	assert.equal(clipboardTextForHost('a\u0000b'), undefined);
	assert.equal(clipboardTextForHost('a\u009bb'), undefined);
	assert.equal(
		clipboardTextForHost('a'.repeat(DESKTOP_CLIPBOARD_BYTES)),
		'a'.repeat(DESKTOP_CLIPBOARD_BYTES),
	);
	assert.equal(
		clipboardTextForHost('a'.repeat(DESKTOP_CLIPBOARD_BYTES + 1)),
		undefined,
	);
	assert.equal(
		clipboardTextForHost('✓'.repeat(DESKTOP_CLIPBOARD_BYTES / 2)),
		undefined,
	);
});

test('host writes need control, desktop focus, document focus and visibility', () => {
	for (let bits = 0; bits < 16; bits++) {
		const state = {
			control: !!(bits & 1),
			focusedInside: !!(bits & 2),
			documentFocused: !!(bits & 4),
			visible: !!(bits & 8),
		};
		assert.equal(mayWriteHostClipboard(state), bits === 15);
	}
});

class FakeRfb extends EventTarget implements ClipboardRfb {
	pasted: string[] = [];
	keys: [number, string | null, boolean | undefined][] = [];
	clipboardPasteFrom(text: string) {
		this.pasted.push(text);
	}
	sendKey(keysym: number, code: string | null, down?: boolean) {
		this.keys.push([keysym, code, down]);
	}
}

function keyEvent(type: string, init: Partial<ShortcutEvent>) {
	return Object.assign(
		new Event(type, { bubbles: true, cancelable: true }),
		key(init.code ?? '', init),
	);
}
function pasteEvent(text: string | null) {
	return Object.assign(
		new Event('paste', { bubbles: true, cancelable: true }),
		{
			clipboardData:
				text === null
					? null
					: { getData: (t: string) => (t === 'text/plain' ? text : '') },
		},
	);
}

function setup(
	overrides: Partial<Parameters<typeof attachDesktopClipboard>[2]> = {},
) {
	const layer = new EventTarget();
	const rfb = new FakeRfb();
	const written: string[] = [];
	let tooLarge = 0;
	const state = {
		focusedInside: true,
		documentFocused: true,
		visible: true,
		catcher: [] as string[],
		timer: undefined as (() => void) | undefined,
	};
	const detach = attachDesktopClipboard(layer, rfb, {
		pasteRoot: layer,
		catcher: {
			focus: () => state.catcher.push('focus'),
			restore: () => state.catcher.push('restore'),
		},
		setTimer: (callback) => {
			state.timer = callback;
			return () => {
				state.timer = undefined;
			};
		},
		isMac: false,
		focusedInside: () => state.focusedInside,
		documentFocused: () => state.documentFocused,
		visible: () => state.visible,
		writeHostClipboard: async (text) => {
			written.push(text);
		},
		onPasteTooLarge: () => tooLarge++,
		...overrides,
	});
	return { layer, rfb, written, state, detach, tooLarge: () => tooLarge };
}

test('the paste shortcut is kept from noVNC, and its native paste reaches the bot once', () => {
	const { layer, rfb, detach } = setup();
	const down = keyEvent('keydown', { code: 'KeyV', ctrlKey: true });
	let reachedNovnc = true;
	down.stopPropagation = () => {
		reachedNovnc = false;
	};
	layer.dispatchEvent(down);
	assert.equal(reachedNovnc, false);
	assert.equal(
		down.defaultPrevented,
		false,
		'the browser must still raise paste',
	);
	const paste = pasteEvent('café ✓');
	layer.dispatchEvent(paste);
	assert.equal(paste.defaultPrevented, true);
	assert.deepEqual(rfb.pasted, ['café ✓']);
	assert.deepEqual(
		rfb.keys.map(([k, , d]) => [k, d]),
		[
			[Control_L, true],
			[v, true],
			[v, false],
			[Control_L, false],
		],
	);
	const up = keyEvent('keyup', { code: 'KeyV', ctrlKey: true });
	let upReached = true;
	up.stopPropagation = () => {
		upReached = false;
	};
	layer.dispatchEvent(up);
	assert.equal(upReached, false);
	detach();
	layer.dispatchEvent(pasteEvent('again'));
	assert.deepEqual(rfb.pasted, ['café ✓']);
});

test('macOS Cmd+V with left Cmd held sends Ctrl+V without Alt', () => {
	const { layer, rfb } = setup({ isMac: true });
	layer.dispatchEvent(keyEvent('keydown', { code: 'MetaLeft', metaKey: true }));
	layer.dispatchEvent(keyEvent('keydown', { code: 'KeyV', metaKey: true }));
	layer.dispatchEvent(pasteEvent('x'));
	assert.deepEqual(rfb.keys[0], [Alt_L, 'MetaLeft', false]);
	assert.deepEqual(rfb.keys.at(-1), [Alt_L, 'MetaLeft', true]);
	assert.deepEqual(
		rfb.keys.slice(1, -1).map(([k, , d]) => [k, d]),
		[
			[Control_L, true],
			[v, true],
			[v, false],
			[Control_L, false],
		],
	);
});

test('a paste with no text, or too large, sends nothing to the bot', () => {
	const { layer, rfb, tooLarge } = setup();
	layer.dispatchEvent(pasteEvent(''));
	layer.dispatchEvent(pasteEvent(null));
	assert.equal(tooLarge(), 0);
	layer.dispatchEvent(pasteEvent('a'.repeat(DESKTOP_CLIPBOARD_BYTES)));
	assert.equal(tooLarge(), 1);
	assert.deepEqual(rfb.pasted, []);
	assert.deepEqual(rfb.keys, []);
});

test('bot clipboard changes reach the host only while the user is on the desktop', () => {
	const { rfb, written, state } = setup();
	const change = (text: string) =>
		rfb.dispatchEvent(new CustomEvent('clipboard', { detail: { text } }));
	change('one');
	state.focusedInside = false;
	change('elsewhere in Terminay');
	state.focusedInside = true;
	state.documentFocused = false;
	change('another app');
	state.documentFocused = true;
	state.visible = false;
	change('hidden tab');
	state.visible = true;
	change('\u001b]52;c;x\u0007');
	change('');
	change('two');
	assert.deepEqual(written, ['one', 'two']);
});

test('a refused host write is ignored', async () => {
	const { rfb } = setup({
		writeHostClipboard: async () => {
			throw new Error('denied');
		},
	});
	rfb.dispatchEvent(new CustomEvent('clipboard', { detail: { text: 'x' } }));
	await new Promise((resolve) => setImmediate(resolve));
});

test('a paste Chromium raises at a stale page selection still reaches the bot', () => {
	// The document; the paste lands on the old selection, outside the layer.
	const root = new EventTarget();
	const { layer, rfb, state } = setup({ pasteRoot: root });
	state.focusedInside = true;
	layer.dispatchEvent(keyEvent('keydown', { code: 'KeyV', ctrlKey: true }));
	const paste = pasteEvent('from host');
	root.dispatchEvent(paste);
	assert.equal(paste.defaultPrevented, true);
	assert.deepEqual(rfb.pasted, ['from host']);
	assert.deepEqual(state.catcher, ['focus', 'restore']);
	// Edit › Paste from the menu, no shortcut seen: focus decides.
	root.dispatchEvent(pasteEvent('menu'));
	assert.deepEqual(rfb.pasted, ['from host', 'menu']);
});

test('a paste elsewhere in Terminay is left alone', () => {
	const root = new EventTarget();
	const { rfb, state } = setup({ pasteRoot: root });
	state.focusedInside = false;
	const paste = pasteEvent('into a text field');
	root.dispatchEvent(paste);
	assert.equal(paste.defaultPrevented, false);
	assert.deepEqual(rfb.pasted, []);
	assert.deepEqual(rfb.keys, []);
});

test('the paste shortcut moves focus to the editable catcher until its paste arrives', () => {
	const { layer, rfb, state } = setup({ isMac: true });
	layer.dispatchEvent(keyEvent('keydown', { code: 'MetaLeft', metaKey: true }));
	layer.dispatchEvent(keyEvent('keydown', { code: 'KeyV', metaKey: true }));
	assert.deepEqual(state.catcher, ['focus']);
	// The move to the catcher is not leaving the desktop: Cmd stays tracked.
	layer.dispatchEvent(new Event('focusout'));
	layer.dispatchEvent(pasteEvent('from mac'));
	assert.deepEqual(state.catcher, ['focus', 'restore']);
	assert.equal(state.timer, undefined);
	assert.deepEqual(rfb.keys[0], [Alt_L, 'MetaLeft', false]);
	assert.deepEqual(rfb.pasted, ['from mac']);
});

test('focus returns to the desktop when no paste comes', () => {
	const { layer, rfb, state } = setup();
	layer.dispatchEvent(keyEvent('keydown', { code: 'KeyV', ctrlKey: true }));
	state.timer?.();
	assert.deepEqual(state.catcher, ['focus', 'restore']);
	// The shortcut is spent: a later paste elsewhere is not ours.
	state.focusedInside = false;
	layer.dispatchEvent(pasteEvent('late'));
	assert.deepEqual(rfb.pasted, []);
});

test('a modifier released while focus is on the catcher is released in the bot', () => {
	const { layer, rfb } = setup({ isMac: true });
	layer.dispatchEvent(
		keyEvent('keydown', { code: 'MetaRight', metaKey: true }),
	);
	layer.dispatchEvent(keyEvent('keydown', { code: 'KeyV', metaKey: true }));
	layer.dispatchEvent(keyEvent('keyup', { code: 'MetaRight' }));
	assert.deepEqual(rfb.keys, [[Super_L, 'MetaRight', false]]);
});
