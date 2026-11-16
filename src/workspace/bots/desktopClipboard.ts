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
 * noVNC's own release later is consistent. Shift is never released: when the
 * chord has it the user is holding it, and noVNC has already pressed it.
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
	/** Whether keyboard focus is inside the desktop layer. */
	focusedInside: () => boolean;
	documentFocused: () => boolean;
	visible: () => boolean;
	writeHostClipboard: (text: string) => Promise<void>;
	onPasteTooLarge: () => void;
}>;

type KeyLike = Event & ShortcutEvent;
type PasteLike = Event & {
	clipboardData?: { getData(type: string): string } | null;
};

/**
 * Wire clipboard sharing onto a control-mode layer. `layer` must be an
 * ancestor of noVNC's canvas so its capture listeners run first. Returns the
 * detach function.
 */
export function attachDesktopClipboard(
	layer: EventTarget,
	rfb: ClipboardRfb,
	env: DesktopClipboardEnvironment,
): () => void {
	const held = new Set<string>();
	const diverted = new Set<string>();
	let pending: LinuxPasteChord | null = null;

	const keydown = (event: Event) => {
		const e = event as KeyLike;
		if (heldModifierKeysym(e.code, env.isMac) !== undefined) held.add(e.code);
		const chord = pasteShortcut(e, env.isMac);
		if (chord === null) return;
		// Keep the key from noVNC without cancelling it, so the browser or the
		// Edit › Paste menu raises a native paste on the focused canvas.
		e.stopPropagation();
		diverted.add(e.code);
		pending = chord;
	};
	const keyup = (event: Event) => {
		const e = event as KeyLike;
		held.delete(e.code);
		if (diverted.delete(e.code)) e.stopPropagation();
	};
	const blur = () => {
		held.clear();
		diverted.clear();
		pending = null;
	};
	const paste = (event: Event) => {
		const e = event as PasteLike;
		e.preventDefault();
		e.stopPropagation();
		const chord = pending ?? 'ctrl+v';
		pending = null;
		const text = e.clipboardData?.getData('text/plain') ?? '';
		if (text.length === 0) return;
		if (!pasteTextFits(text)) {
			env.onPasteTooLarge();
			return;
		}
		rfb.clipboardPasteFrom(text);
		for (const step of pasteChordKeys(chord, held, env.isMac))
			rfb.sendKey(step.keysym, step.code, step.down);
	};
	const clipboard = (event: Event) => {
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
	layer.addEventListener('paste', paste, { capture: true });
	rfb.addEventListener('clipboard', clipboard);
	return () => {
		layer.removeEventListener('keydown', keydown, { capture: true });
		layer.removeEventListener('keyup', keyup, { capture: true });
		layer.removeEventListener('focusout', blur, { capture: true });
		layer.removeEventListener('paste', paste, { capture: true });
		rfb.removeEventListener('clipboard', clipboard);
	};
}
