/**
 * The terminal launchers one server offers, such as an installed coding agent
 * (ADR-0073). A client lists them and names one when it creates a terminal;
 * the server decides what it starts. A server without them is sent nothing.
 */

import { FEATURE_CAPABILITIES } from '@terminay/protocol';
import type { QueryCommandTransport } from './queryCommand.js';
import type { ClientEvent } from './types.js';

/** Mirrors the server's launcher operation names. */
export const TERMINAL_LAUNCHER_OPERATIONS = Object.freeze({
	list: 'terminal.launchers',
	changed: 'terminal.launchers.changed',
} as const);

export interface TerminalLauncher {
	readonly id: string;
	readonly displayName: string;
	/** An id from Terminay's icon allowlist. */
	readonly icon: string;
}

export interface TerminalLauncherClientTransport extends QueryCommandTransport {
	subscribe: (
		event: string,
		listener: (event: ClientEvent<unknown>) => void,
		onResync?: () => void,
	) => (() => void) | Promise<() => void>;
}

/** Whether a server's hello says it offers terminal launchers. */
export function serverOffersTerminalLaunchers(
	capabilities: readonly string[],
): boolean {
	return capabilities.includes(FEATURE_CAPABILITIES.terminalLaunchers);
}

const ID = /^[a-z0-9][a-z0-9.-]{0,126}\/[a-z][a-z0-9-]{0,63}$/u;

/** Keeps only well-formed launchers, bounded, from a list the server sent. */
export function parseTerminalLaunchers(
	value: unknown,
): readonly TerminalLauncher[] {
	const list =
		typeof value === 'object' && value !== null && !Array.isArray(value)
			? (value as { launchers?: unknown }).launchers
			: undefined;
	if (!Array.isArray(list)) return Object.freeze([]);
	const seen = new Set<string>();
	const launchers: TerminalLauncher[] = [];
	for (const entry of list.slice(0, 32)) {
		if (typeof entry !== 'object' || entry === null) continue;
		const { id, displayName, icon } = entry as Record<string, unknown>;
		if (
			typeof id !== 'string' ||
			!ID.test(id) ||
			seen.has(id) ||
			typeof displayName !== 'string' ||
			displayName.trim().length === 0 ||
			displayName.length > 96 ||
			typeof icon !== 'string' ||
			icon.length === 0 ||
			icon.length > 64
		)
			continue;
		seen.add(id);
		launchers.push(Object.freeze({ id, displayName, icon }));
	}
	return Object.freeze(launchers);
}

/**
 * Follows one server's launchers: reads them once, and again whenever the
 * server says they changed or the event stream resynchronises. Returns a stop
 * function. A failed read reports an empty list.
 */
export function followTerminalLaunchers(
	transport: TerminalLauncherClientTransport,
	onLaunchers: (launchers: readonly TerminalLauncher[]) => void,
): () => void {
	let stopped = false;
	let generation = 0;
	const load = () => {
		const current = ++generation;
		void Promise.resolve(transport.query(TERMINAL_LAUNCHER_OPERATIONS.list))
			.then((value) => parseTerminalLaunchers(value))
			.catch(() => Object.freeze([]) as readonly TerminalLauncher[])
			.then((launchers) => {
				if (!stopped && current === generation) onLaunchers(launchers);
			});
	};
	let unsubscribe: (() => void) | undefined;
	void Promise.resolve(
		transport.subscribe(TERMINAL_LAUNCHER_OPERATIONS.changed, load, load),
	)
		.then((stop) => {
			if (stopped) stop();
			else unsubscribe = stop;
		})
		.catch(() => undefined);
	load();
	return () => {
		stopped = true;
		unsubscribe?.();
	};
}
