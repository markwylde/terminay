import type { TerminalKey } from '@terminay/server-core';

/**
 * The key names write_terminal accepts. Type-only imports keep the stdio
 * entry free of server-core at runtime; `satisfies` and the check below pin
 * this list to server-core's TERMINAL_KEYS, which holds the bytes.
 */
export const TERMINAL_KEY_NAMES = [
	'Enter',
	'Tab',
	'Shift+Tab',
	'Escape',
	'Backspace',
	'Delete',
	'Up',
	'Down',
	'Right',
	'Left',
	'Home',
	'End',
	'PageUp',
	'PageDown',
	'Space',
	'Ctrl+A',
	'Ctrl+C',
	'Ctrl+D',
	'Ctrl+E',
	'Ctrl+K',
	'Ctrl+L',
	'Ctrl+R',
	'Ctrl+U',
	'Ctrl+W',
	'Ctrl+Z',
] as const satisfies readonly TerminalKey[];

const everyKeyListed: Exclude<
	TerminalKey,
	(typeof TERMINAL_KEY_NAMES)[number]
> extends never
	? true
	: false = true;
void everyKeyListed;

/** The most keys one write_terminal call may press. */
export const MAX_TERMINAL_KEYS = 64;

export function isTerminalKeyName(value: unknown): value is TerminalKey {
	return (
		typeof value === 'string' &&
		(TERMINAL_KEY_NAMES as readonly string[]).includes(value)
	);
}
