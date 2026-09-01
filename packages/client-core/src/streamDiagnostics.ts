/**
 * Client-side terminal streaming diagnostics.
 *
 * The mirror of the server module, with one addition that matters more than
 * anything it records: it publishes itself on `globalThis` as
 * `__terminayStream`. A terminal that has frozen cannot be interrogated by
 * reading logs that scrolled past or were never enabled — it has to be asked,
 * from the console, while it is still stuck:
 *
 *   __terminayStream.snapshot()   // live attachment state, right now
 *   __terminayStream.history()    // bounded lifecycle record
 *   __terminayStream.verbose(true)
 *
 * Lifecycle records (attach, skip, gap, detach) are kept unconditionally; they
 * are rare, and a freeze reported after the fact still has evidence behind it.
 * Per-event records are gated because output is a hot path.
 */

export interface TerminalStreamDiagnosticRecord {
	readonly seq: number;
	readonly at: number;
	readonly event: string;
	readonly detail: Readonly<Record<string, unknown>>;
}

export type TerminalStreamStateProvider = () => unknown;

const HISTORY_LIMIT = 512;

const history: TerminalStreamDiagnosticRecord[] = [];
const providers = new Map<string, TerminalStreamStateProvider>();

let sequence = 0;
let verbose = false;
/** Logging to the console is what makes a freeze visible as it happens rather
 * than only under later interrogation. Lifecycle records are loud by default. */
let echoToConsole = true;

export function terminalStreamDiagnosticsVerbose(): boolean {
	return verbose;
}

export function recordTerminalStreamDiagnostic(
	event: string,
	detail: Readonly<Record<string, unknown>> = {},
): void {
	sequence += 1;
	const record: TerminalStreamDiagnosticRecord = {
		seq: sequence,
		at: Date.now(),
		event,
		detail,
	};
	history.push(record);
	if (history.length > HISTORY_LIMIT)
		history.splice(0, history.length - HISTORY_LIMIT);
	if (echoToConsole) console.debug('[terminay-stream]', event, detail);
}

export function recordVerboseTerminalStreamDiagnostic(
	event: string,
	detail: () => Readonly<Record<string, unknown>>,
): void {
	if (!verbose) return;
	recordTerminalStreamDiagnostic(event, detail());
}

export function registerTerminalStreamStateProvider(
	name: string,
	provider: TerminalStreamStateProvider,
): () => void {
	providers.set(name, provider);
	return () => {
		if (providers.get(name) === provider) providers.delete(name);
	};
}

export interface TerminalStreamDiagnosticSnapshot {
	readonly at: number;
	readonly verbose: boolean;
	readonly state: Readonly<Record<string, unknown>>;
	readonly history: readonly TerminalStreamDiagnosticRecord[];
}

export function terminalStreamDiagnosticSnapshot(): TerminalStreamDiagnosticSnapshot {
	const state: Record<string, unknown> = {};
	for (const [name, provider] of providers) {
		try {
			state[name] = provider();
		} catch (error) {
			state[name] = {
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}
	return { at: Date.now(), verbose, state, history: [...history] };
}

export interface TerminalStreamDiagnosticConsole {
	readonly snapshot: () => TerminalStreamDiagnosticSnapshot;
	readonly history: () => readonly TerminalStreamDiagnosticRecord[];
	readonly verbose: (value?: boolean) => boolean;
	readonly echo: (value?: boolean) => boolean;
}

export function terminalStreamDiagnosticConsole(): TerminalStreamDiagnosticConsole {
	return {
		snapshot: terminalStreamDiagnosticSnapshot,
		history: () => [...history],
		verbose: (value) => {
			if (value !== undefined) verbose = value;
			return verbose;
		},
		echo: (value) => {
			if (value !== undefined) echoToConsole = value;
			return echoToConsole;
		},
	};
}

/** Attach the console handle. Idempotent, and silent where `globalThis` is
 * frozen or the property is already defined by an earlier bundle. */
export function installTerminalStreamDiagnostics(): void {
	const target = globalThis as Record<string, unknown>;
	if (target.__terminayStream !== undefined) return;
	try {
		target.__terminayStream = terminalStreamDiagnosticConsole();
	} catch {
		/* A hardened global is not a reason to fail a terminal. */
	}
}

/** Test seam. */
export function resetTerminalStreamDiagnostics(): void {
	history.length = 0;
	providers.clear();
	sequence = 0;
	verbose = false;
	echoToConsole = true;
}

installTerminalStreamDiagnostics();
