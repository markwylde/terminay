export type TerminalMobileModifier = 'alt' | 'ctrl' | 'shift';

export type TerminalMobileModifiers = Readonly<{
	alt: boolean;
	ctrl: boolean;
	shift: boolean;
}>;

export const EMPTY_TERMINAL_MOBILE_MODIFIERS: TerminalMobileModifiers = {
	alt: false,
	ctrl: false,
	shift: false,
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
	return modifiers.alt || modifiers.ctrl || modifiers.shift;
}

export function toggleTerminalMobileModifier(
	modifiers: TerminalMobileModifiers,
	modifier: TerminalMobileModifier,
): TerminalMobileModifiers {
	return { ...modifiers, [modifier]: !modifiers[modifier] };
}

/**
 * Applies the familiar terminal modifier encoding to one accessory or virtual
 * keyboard input. Modifiers are intentionally consumed by the caller after a
 * single input so a user cannot accidentally leave Ctrl latched in a shell.
 */
export function applyTerminalMobileModifiers(
	input: string,
	modifiers: TerminalMobileModifiers,
): string {
	let data = input;
	const arrowFinal = ARROW_FINALS[data];
	let altIsEncoded = false;
	if (arrowFinal !== undefined && hasTerminalMobileModifier(modifiers)) {
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
