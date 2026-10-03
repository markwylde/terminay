/**
 * How long terminal sessions keep running with no server attached.
 *
 * A server-owned setting: it governs processes on the server's machine, so
 * every client of that server sees and changes the same value.
 */
export const KEEP_TERMINALS_AFTER_QUIT_VALUES = [
	'1m',
	'5m',
	'30m',
	'2h',
	'untilRestart',
] as const;

export type KeepTerminalsAfterQuit =
	(typeof KEEP_TERMINALS_AFTER_QUIT_VALUES)[number];

export const DEFAULT_KEEP_TERMINALS_AFTER_QUIT: KeepTerminalsAfterQuit = '5m';

const LIMIT_MS: Readonly<Record<KeepTerminalsAfterQuit, number | null>> = {
	'1m': 60_000,
	'5m': 5 * 60_000,
	'30m': 30 * 60_000,
	'2h': 2 * 60 * 60_000,
	untilRestart: null,
};

export function normalizeKeepTerminalsAfterQuit(
	value: unknown,
): KeepTerminalsAfterQuit {
	return (KEEP_TERMINALS_AFTER_QUIT_VALUES as readonly unknown[]).includes(value)
		? (value as KeepTerminalsAfterQuit)
		: DEFAULT_KEEP_TERMINALS_AFTER_QUIT;
}

/** The unattached limit in milliseconds, or `null` for no limit. */
export function backgroundTerminalLimitMs(value: unknown): number | null {
	return LIMIT_MS[normalizeKeepTerminalsAfterQuit(value)];
}
