/**
 * Terminal streaming diagnostics.
 *
 * The delivery pump, the attachment protocol, and the PTY bridge each hold one
 * piece of the answer to "why did this terminal stop painting?", and none of
 * them can see the others. This module is the seam where those pieces meet.
 *
 * Two surfaces, deliberately different in cost:
 *
 * - A bounded **history** of lifecycle records. Attach, hydrate, congest,
 *   suppress, release, and fault are rare, so they are recorded unconditionally
 *   and survive without anybody having opted in. A freeze reported after the
 *   fact still has evidence behind it.
 * - A live **snapshot** assembled from registered providers. History rolls over;
 *   a terminal that froze during an hour of laptop sleep may have pushed its
 *   cause off the end of the ring. Current lane state cannot roll over, and for
 *   a stuck stream it is the decisive reading: a lane latched `suppressed` with
 *   the client still acking is a different bug from a lane that never queued.
 *
 * Per-chunk records are gated behind `TERMINAY_DEBUG_STREAM` because terminal
 * output admission is a hot path.
 */

export interface StreamDiagnosticRecord {
	readonly seq: number;
	readonly at: number;
	readonly scope: StreamDiagnosticScope;
	readonly event: string;
	readonly detail: Readonly<Record<string, unknown>>;
}

export type StreamDiagnosticScope =
	| 'delivery'
	| 'attach'
	| 'pty'
	| 'adapter'
	| 'transport';

export type StreamDiagnosticListener = (record: StreamDiagnosticRecord) => void;

/** Providers expose live state rather than a copy taken at record time, so a
 * snapshot always reflects the stream as it stands when the question is asked. */
export type StreamStateProvider = () => unknown;

const HISTORY_LIMIT = 512;

const history: StreamDiagnosticRecord[] = [];
const listeners = new Set<StreamDiagnosticListener>();
const providers = new Map<string, StreamStateProvider>();

let sequence = 0;
let verbose = readVerboseDefault();

function readVerboseDefault(): boolean {
	const value = globalThis.process?.env?.TERMINAY_DEBUG_STREAM;
	return value !== undefined && value !== '' && value !== '0' && value !== 'false';
}

/** True when per-chunk records are wanted. Guard hot paths on this rather than
 * paying for a detail object that is thrown away. */
export function streamDiagnosticsVerbose(): boolean {
	return verbose;
}

export function setStreamDiagnosticsVerbose(value: boolean): void {
	verbose = value;
}

export function recordStreamDiagnostic(
	scope: StreamDiagnosticScope,
	event: string,
	detail: Readonly<Record<string, unknown>> = {},
): void {
	sequence += 1;
	const record: StreamDiagnosticRecord = {
		seq: sequence,
		at: Date.now(),
		scope,
		event,
		detail,
	};
	history.push(record);
	if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
	// Under `TERMINAY_DEBUG_STREAM` the host process log is the fastest place to
	// watch a freeze happen, so records go there as well as into the ring.
	if (verbose) console.debug('[terminay-stream]', scope, event, detail);
	for (const listener of listeners) {
		// A diagnostic sink must never be able to break the stream it observes.
		try {
			listener(record);
		} catch {
			/* ignored */
		}
	}
}

/** Record only when verbose diagnostics are on, without building `detail` first. */
export function recordVerboseStreamDiagnostic(
	scope: StreamDiagnosticScope,
	event: string,
	detail: () => Readonly<Record<string, unknown>>,
): void {
	if (!verbose) return;
	recordStreamDiagnostic(scope, event, detail());
}

export function onStreamDiagnostic(listener: StreamDiagnosticListener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function streamDiagnosticHistory(): readonly StreamDiagnosticRecord[] {
	return [...history];
}

export function registerStreamStateProvider(
	name: string,
	provider: StreamStateProvider,
): () => void {
	providers.set(name, provider);
	return () => {
		if (providers.get(name) === provider) providers.delete(name);
	};
}

export interface StreamDiagnosticSnapshot {
	readonly at: number;
	readonly verbose: boolean;
	readonly state: Readonly<Record<string, unknown>>;
	readonly history: readonly StreamDiagnosticRecord[];
}

export function streamDiagnosticSnapshot(): StreamDiagnosticSnapshot {
	const state: Record<string, unknown> = {};
	for (const [name, provider] of providers) {
		try {
			state[name] = provider();
		} catch (error) {
			state[name] = { error: error instanceof Error ? error.message : String(error) };
		}
	}
	return { at: Date.now(), verbose, state, history: [...history] };
}

/** Test seam. Production code never needs to forget what it has seen. */
export function resetStreamDiagnostics(): void {
	history.length = 0;
	listeners.clear();
	providers.clear();
	sequence = 0;
	verbose = readVerboseDefault();
}
