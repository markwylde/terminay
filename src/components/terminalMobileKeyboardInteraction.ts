export type TerminalMobileModifier = 'alt' | 'ctrl' | 'shift';

/**
 * A modifier on the accessory row works like Shift on the iOS keyboard. One tap
 * applies it to the next key only; a second tap locks it on for every key until
 * a third tap releases it.
 */
export type TerminalMobileModifierLatch = 'off' | 'once' | 'locked';

export type TerminalMobileModifiers = Readonly<
	Record<TerminalMobileModifier, TerminalMobileModifierLatch>
>;

export const EMPTY_TERMINAL_MOBILE_MODIFIERS: TerminalMobileModifiers = {
	alt: 'off',
	ctrl: 'off',
	shift: 'off',
};

const NEXT_LATCH: Readonly<
	Record<TerminalMobileModifierLatch, TerminalMobileModifierLatch>
> = {
	off: 'once',
	once: 'locked',
	locked: 'off',
};

const CONTROL_CHARACTER_CODES: Readonly<Record<string, number>> = {
	'@': 0,
	'[': 27,
	'\\': 28,
	']': 29,
	'^': 30,
	_: 31,
	'?': 127,
};

const ARROW_FINALS: Readonly<Record<string, string>> = {
	'\x1b[A': 'A',
	'\x1b[B': 'B',
	'\x1b[C': 'C',
	'\x1b[D': 'D',
};

export function hasTerminalMobileModifier(
	modifiers: TerminalMobileModifiers,
): boolean {
	return (
		modifiers.alt !== 'off' ||
		modifiers.ctrl !== 'off' ||
		modifiers.shift !== 'off'
	);
}

/**
 * Whether a chunk xterm emitted through onData is something the user typed,
 * and so should consume a latched modifier. A software keyboard cannot type
 * ESC, so data that starts with one is a report xterm generated itself, such
 * as the focus-in report an app that enabled DECSET 1004 gets when a tap on
 * the accessory row blurs and refocuses the terminal. Letting that report take
 * the modifier left the next typed key unmodified.
 */
export function isTerminalMobileModifierTarget(data: string): boolean {
	return data.length > 0 && !data.startsWith('\x1b');
}

export function advanceTerminalMobileModifier(
	modifiers: TerminalMobileModifiers,
	modifier: TerminalMobileModifier,
): TerminalMobileModifiers {
	return { ...modifiers, [modifier]: NEXT_LATCH[modifiers[modifier]] };
}

/**
 * The modifiers left after one input: a one-shot modifier is spent, and a
 * locked one stays on until the user taps it off.
 */
export function consumeTerminalMobileModifiers(
	modifiers: TerminalMobileModifiers,
): TerminalMobileModifiers {
	const spend = (latch: TerminalMobileModifierLatch) =>
		latch === 'once' ? 'off' : latch;
	return {
		alt: spend(modifiers.alt),
		ctrl: spend(modifiers.ctrl),
		shift: spend(modifiers.shift),
	};
}

/**
 * Applies the familiar terminal modifier encoding to one accessory or virtual
 * keyboard input. The caller consumes the modifiers after each input, so a
 * one-shot modifier affects exactly one key.
 */
export function applyTerminalMobileModifiers(
	input: string,
	latches: TerminalMobileModifiers,
): string {
	const modifiers = {
		alt: latches.alt !== 'off',
		ctrl: latches.ctrl !== 'off',
		shift: latches.shift !== 'off',
	};
	let data = input;
	const arrowFinal = ARROW_FINALS[data];
	let altIsEncoded = false;
	if (arrowFinal !== undefined && hasTerminalMobileModifier(latches)) {
		const modifierParameter =
			1 +
			(modifiers.shift ? 1 : 0) +
			(modifiers.alt ? 2 : 0) +
			(modifiers.ctrl ? 4 : 0);
		data = `\x1b[1;${modifierParameter}${arrowFinal}`;
		altIsEncoded = modifiers.alt;
	} else if (data === '\t' && modifiers.shift) {
		data = '\x1b[Z';
	} else if (data.length === 1 && modifiers.ctrl) {
		data = controlCharacter(data);
	} else if (data.length === 1 && modifiers.shift) {
		data = data.toUpperCase();
	}

	return modifiers.alt && !altIsEncoded ? `\x1b${data}` : data;
}

function controlCharacter(character: string): string {
	const upper = character.toUpperCase();
	if (upper >= 'A' && upper <= 'Z') {
		return String.fromCharCode(upper.charCodeAt(0) - 64);
	}

	const code = CONTROL_CHARACTER_CODES[character];
	return code === undefined ? character : String.fromCharCode(code);
}

export function shouldFocusTerminalForTouchPointer(
	pointerType: unknown,
): boolean {
	return pointerType === 'touch';
}

export function shouldFocusTerminalForTouchStart(
	supportsPointerEvents: boolean,
): boolean {
	return !supportsPointerEvents;
}

export type TerminalTapPointerLike = {
	clientX: number;
	clientY: number;
	pointerId: number;
};

export type TerminalTapSession = {
	dispose: () => void;
	pointerCancel: (event: Pick<TerminalTapPointerLike, 'pointerId'>) => void;
	pointerDown: (event: TerminalTapPointerLike) => void;
	pointerMove: (event: TerminalTapPointerLike) => void;
	pointerUp: (event: Pick<TerminalTapPointerLike, 'pointerId'>) => boolean;
};

/**
 * Single-pointer tap vs scroll session. Arms on down, disarms past the shared
 * tap-versus-drag movement threshold or on cancel, and reports whether a
 * release should claim terminal focus. A still finger is a tap regardless of
 * how long it rests before lifting.
 */
export function createTerminalTapSession({
	moveThresholdPx,
}: {
	moveThresholdPx: number;
}): TerminalTapSession {
	let armed = false;
	let pointerId: number | null = null;
	let startX = 0;
	let startY = 0;

	const reset = () => {
		armed = false;
		pointerId = null;
	};

	return {
		pointerDown(event) {
			if (pointerId !== null && event.pointerId !== pointerId) return;
			pointerId = event.pointerId;
			startX = event.clientX;
			startY = event.clientY;
			armed = true;
		},
		pointerMove(event) {
			if (event.pointerId !== pointerId || !armed) return;
			if (
				Math.hypot(event.clientX - startX, event.clientY - startY) <
				moveThresholdPx
			) {
				return;
			}
			armed = false;
		},
		pointerUp(event) {
			if (event.pointerId !== pointerId) return false;
			const shouldClaim = armed;
			reset();
			return shouldClaim;
		},
		pointerCancel(event) {
			if (event.pointerId !== pointerId) return;
			reset();
		},
		dispose() {
			reset();
		},
	};
}
