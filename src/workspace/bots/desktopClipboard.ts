/**
 * Clipboard sharing for a bot desktop in control mode (ADR-0129).
 *
 * Device → bot: only the native paste of the user's paste shortcut. The
 * shortcut is kept from noVNC so the browser raises `paste`; its text goes to
 * the bot's clipboard and the matching Linux chord is pressed there, built
 * explicitly rather than from whatever modifiers noVNC holds in the bot.
 *
 * Bot → device: only while the desktop holds keyboard focus in a focused,
 * visible window, through the host's semantic clipboard write.
 */

export type LinuxPasteChord = 'ctrl+v' | 'ctrl+shift+v' | 'shift+insert';

export const DESKTOP_CLIPBOARD_BYTES = 1024 * 1024;

const XK = {
	Shift_L: 0xffe1,
	Shift_R: 0xffe2,
	Control_L: 0xffe3,
	Control_R: 0xffe4,
	Alt_L: 0xffe9,
	Super_L: 0xffeb,
	Insert: 0xff63,
	v: 0x0076,
} as const;

export type ShortcutEvent = Readonly<{
	code: string;
	key: string;
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
	metaKey: boolean;
}>;

/** The Linux chord a host paste shortcut stands for, or null. */
export function pasteShortcut(
	event: ShortcutEvent,
	isMac: boolean,
): LinuxPasteChord | null {
	if (event.altKey) return null;
	const isV = event.code === 'KeyV' || event.key === 'v' || event.key === 'V';
	if (isMac) {
		if (!event.metaKey || event.ctrlKey || !isV) return null;
		return event.shiftKey ? 'ctrl+shift+v' : 'ctrl+v';
	}
	if (event.metaKey) return null;
	if (event.code === 'Insert' && event.shiftKey && !event.ctrlKey)
		return 'shift+insert';
	if (!event.ctrlKey || !isV) return null;
	return event.shiftKey ? 'ctrl+shift+v' : 'ctrl+v';
}

/** Host modifier codes whose bot keysym noVNC holds while they are down. */
export function heldModifierKeysym(
	code: string,
	isMac: boolean,
): number | undefined {
	if (code === 'ShiftLeft') return XK.Shift_L;
	if (code === 'ShiftRight') return XK.Shift_R;
	if (isMac) {
		// noVNC swaps Cmd for the remote: left Cmd is Alt_L, right Cmd Super_L.
		if (code === 'MetaLeft') return XK.Alt_L;
		if (code === 'MetaRight') return XK.Super_L;
		return undefined;
	}
	if (code === 'ControlLeft') return XK.Control_L;
	if (code === 'ControlRight') return XK.Control_R;
	return undefined;
}

export type KeyStep = Readonly<{ keysym: number; code: string; down: boolean }>;

/**
 * The exact key sequence that presses `chord` in the bot, independent of the
 * modifiers noVNC holds there: release the held host modifiers that are not
 * part of the chord, press the chord, then press those modifiers again so
 * noVNC's own release later is consistent. The complete chord, including
 * Shift, is synthesized even if the host modifiers have since been released.
 */
export function pasteChordKeys(
	chord: LinuxPasteChord,
	heldCodes: Iterable<string>,
	isMac: boolean,
): KeyStep[] {
	const held: KeyStep[] = [];
	for (const code of heldCodes) {
		const keysym = heldModifierKeysym(code, isMac);
		if (keysym !== undefined) held.push({ keysym, code, down: false });
	}
	const steps: KeyStep[] = [...held];
	const pressed: KeyStep[] = [];
	const press = (keysym: number, code: string) => {
		steps.push({ keysym, code, down: true });
		pressed.unshift({ keysym, code, down: false });
	};
	if (chord !== 'shift+insert') press(XK.Control_L, 'ControlLeft');
	if (chord !== 'ctrl+v') press(XK.Shift_L, 'ShiftLeft');
	const key =
		chord === 'shift+insert'
			? { keysym: XK.Insert, code: 'Insert' }
			: { keysym: XK.v, code: 'KeyV' };
	steps.push({ ...key, down: true }, { ...key, down: false });
	steps.push(...pressed);
	steps.push(...held.map((step) => ({ ...step, down: true })));
	return steps;
}

const encoder = new TextEncoder();

/** Whether a paste fits the bot: UTF-8 with CRLF line endings plus the NUL
 * noVNC appends, within the relay's and Xvnc's 1 MiB. */
export function pasteTextFits(text: string): boolean {
	// Cheap upper bound first: a UTF-16 unit is at most 3 UTF-8 bytes, plus one
	// byte per line ending that grows to CRLF.
	if (text.length * 4 + 1 <= DESKTOP_CLIPBOARD_BYTES) return true;
	const normalised = text.replace(/\r\n|\r|\n/g, '\r\n');
	return encoder.encode(normalised).length + 1 <= DESKTOP_CLIPBOARD_BYTES;
}

function hasDisallowedControl(text: string): boolean {
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		if (c === 9 || c === 10 || c === 13) continue;
		if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) return true;
	}
	return false;
}

/** Text from the bot that may be written to the device, or undefined. Same
 * rule as OSC 52 (ADR-0112): bounded, non-empty, no controls but tab/LF/CR. */
export function clipboardTextForHost(text: unknown): string | undefined {
	if (typeof text !== 'string' || text.length === 0) return undefined;
	if (text.length > DESKTOP_CLIPBOARD_BYTES) return undefined;
	if (encoder.encode(text).length > DESKTOP_CLIPBOARD_BYTES) return undefined;
	if (hasDisallowedControl(text)) return undefined;
	return text;
}

export function mayWriteHostClipboard(
	state: Readonly<{
		control: boolean;
		focusedInside: boolean;
		documentFocused: boolean;
		visible: boolean;
	}>,
): boolean {
	return (
		state.control &&
		state.focusedInside &&
		state.documentFocused &&
		state.visible
	);
}

/** The noVNC surface this module drives. */
export interface ClipboardRfb {
	clipboardPasteFrom(text: string): void;
	sendKey(keysym: number, code: string | null, down?: boolean): void;
	addEventListener(type: 'clipboard', listener: (event: Event) => void): void;
	removeEventListener(
		type: 'clipboard',
		listener: (event: Event) => void,
	): void;
}

export type DesktopClipboardEnvironment = Readonly<{
	isMac: boolean;
	/** Continuous sharing owns bot-to-host writes; keep this listener idle. */
	sharingOwnsClipboard?: () => boolean;
	/** Whether keyboard focus is inside the desktop layer. */
	focusedInside: () => boolean;
	documentFocused: () => boolean;
	visible: () => boolean;
	writeHostClipboard: (text: string) => Promise<void>;
	onPasteTooLarge: () => void;
	/** Where `paste` is heard: the document. Chromium raises it at the page's
	 * selection, which need not be inside the layer. */
	pasteRoot: EventTarget;
	/**
	 * An invisible textarea inside the layer. The paste shortcut moves focus
	 * there so the native paste has an editable target: on macOS Edit › Paste
	 * (Cmd+V) needs editable focus, and a stale selection elsewhere on the page
	 * would otherwise take the event. `restore` returns focus to the desktop.
	 */
	catcher: Readonly<{ focus: () => void; restore: () => void }>;
	/** Bounds how long focus waits on the catcher for a paste that never comes. */
	setTimer?: (callback: () => void, ms: number) => () => void;
	/**
	 * Desktop's clipboard read, the same narrow bridge a terminal's paste
	 * shortcut uses. Electron does not reliably raise a native paste for a
	 * shortcut on the desktop, so where this exists the shortcut is cancelled
	 * and the text read here instead. Resolves to undefined when the clipboard
	 * holds no text. Browser hosts leave it out and use the native paste.
	 */
	readHostText?: () => Promise<string | undefined>;
}>;

type KeyLike = Event & ShortcutEvent;
type PasteLike = Event & {
	clipboardData?: { getData(type: string): string } | null;
};

/**
 * Wire clipboard sharing onto a control-mode layer. `layer` must be an
 * ancestor of noVNC's canvas and of the catcher, so its capture listeners run
 * first. Returns the detach function.
 */
export function attachDesktopClipboard(
	layer: EventTarget,
	rfb: ClipboardRfb,
	env: DesktopClipboardEnvironment,
): () => void {
	let attached = true;
	const held = new Set<string>();
	const diverted = new Set<string>();
	let pending: LinuxPasteChord | null = null;
	let catching = false;
	let cancelTimer: (() => void) | undefined;
	const setTimer =
		env.setTimer ??
		((callback: () => void, ms: number) => {
			const id = setTimeout(callback, ms);
			return () => clearTimeout(id);
		});

	const stopCatching = () => {
		cancelTimer?.();
		cancelTimer = undefined;
		if (!catching) return;
		catching = false;
		env.catcher.restore();
	};
	const send = (text: string, chord: LinuxPasteChord) => {
		if (!attached) return;
		if (text.length === 0) return;
		if (!pasteTextFits(text)) {
			env.onPasteTooLarge();
			return;
		}
		rfb.clipboardPasteFrom(text);
		// The modifiers held now, not at keydown: one released meanwhile has
		// already been released in the bot.
		for (const step of pasteChordKeys(chord, held, env.isMac))
			rfb.sendKey(step.keysym, step.code, step.down);
	};
	const keydown = (event: Event) => {
		const e = event as KeyLike;
		if (
			heldModifierKeysym(e.code, env.isMac) !== undefined &&
			!(env.isMac && e.metaKey && e.code.startsWith('Shift'))
		)
			held.add(e.code);
		const chord = pasteShortcut(e, env.isMac);
		if (chord === null) return;
		const readHostText = env.readHostText;
		if (readHostText !== undefined) {
			// Desktop: cancel the shortcut, as a terminal does, so neither
			// noVNC nor Edit › Paste acts on it, and read the clipboard.
			e.preventDefault();
			e.stopPropagation();
			diverted.add(e.code);
			if ((e as Event & { repeat?: boolean }).repeat === true) return;
			void readHostText()
				.then((text) => send(text ?? '', chord))
				.catch(() => undefined);
			return;
		}
		// Keep the key from noVNC without cancelling it, so the browser or the
		// Edit › Paste menu raises a native paste, aimed at the catcher.
		e.stopPropagation();
		diverted.add(e.code);
		pending = chord;
		catching = true;
		env.catcher.focus();
		cancelTimer?.();
		cancelTimer = setTimer(() => {
			pending = null;
			stopCatching();
		}, 1000);
	};
	const keyup = (event: Event) => {
		const e = event as KeyLike;
		held.delete(e.code);
		if (diverted.delete(e.code)) {
			e.stopPropagation();
			return;
		}
		// A modifier released while focus sits on the catcher never reaches
		// noVNC's canvas listener, so release it in the bot here.
		const keysym = heldModifierKeysym(e.code, env.isMac);
		if (catching && keysym !== undefined) rfb.sendKey(keysym, e.code, false);
	};
	const blur = () => {
		// Moving focus to the catcher, or back, is not leaving the desktop.
		if (catching) return;
		held.clear();
		diverted.clear();
		pending = null;
	};
	const paste = (event: Event) => {
		// Ours only when the shortcut was just pressed on the desktop, or the
		// desktop holds focus (Edit › Paste chosen from the menu).
		if (pending === null && !env.focusedInside()) return;
		const e = event as PasteLike;
		e.preventDefault();
		e.stopPropagation();
		const chord = pending ?? 'ctrl+v';
		pending = null;
		stopCatching();
		send(e.clipboardData?.getData('text/plain') ?? '', chord);
	};
	const clipboard = (event: Event) => {
		if (env.sharingOwnsClipboard?.()) return;
		const detail = (event as CustomEvent<{ text?: unknown }>).detail;
		if (
			!mayWriteHostClipboard({
				control: true,
				focusedInside: env.focusedInside(),
				documentFocused: env.documentFocused(),
				visible: env.visible(),
			})
		)
			return;
		const text = clipboardTextForHost(detail?.text);
		if (text === undefined) return;
		void env.writeHostClipboard(text).catch(() => undefined);
	};

	layer.addEventListener('keydown', keydown, { capture: true });
	layer.addEventListener('keyup', keyup, { capture: true });
	layer.addEventListener('focusout', blur, { capture: true });
	env.pasteRoot.addEventListener('paste', paste, { capture: true });
	rfb.addEventListener('clipboard', clipboard);
	return () => {
		attached = false;
		cancelTimer?.();
		layer.removeEventListener('keydown', keydown, { capture: true });
		layer.removeEventListener('keyup', keyup, { capture: true });
		layer.removeEventListener('focusout', blur, { capture: true });
		env.pasteRoot.removeEventListener('paste', paste, { capture: true });
		rfb.removeEventListener('clipboard', clipboard);
	};
}
