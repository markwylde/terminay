import type {
	AgentFileWatchChunk,
	AgentFileWatcher,
	AgentTerminalContext,
} from '@terminay/extension-api';

/**
 * Claude Code writes nothing at all while a permission prompt is open: an
 * assistant record is flushed together with its `tool_result` only once the
 * tool has completed, so the journal never shows an outstanding call. Silence
 * inside an open turn is therefore the only journal-visible trace of a prompt
 * waiting on the user.
 *
 * Measured on real sessions: within a turn during ordinary uninterrupted work
 * the longest quiet interval was 66.7s (median 0.07s, p90 5.1s). The gaps that
 * ran to 188s and 508s were all `turn_duration` to the next turn header, which
 * is the genuinely idle window and is explicitly bounded on both sides, so it
 * never falls inside an open turn. The window below clears that measured
 * ceiling with room for a slower host.
 *
 * Re-measure when the mapping version changes.
 */
export const INPUT_REQUEST_WINDOW_MS = 120_000;
export const MEASURED_IN_TURN_QUIET_CEILING_MS = 66_700;

/** The synthetic record a quiet window produces. It never reaches a journal. */
export const QUIET_RECORD = { type: 'terminay-quiet' } as const;
const QUIET_CHUNK: AgentFileWatchChunk = {
	type: 'append',
	bytes: new TextEncoder().encode(`${JSON.stringify(QUIET_RECORD)}\n`),
};

/** Shells a provider CLI is normally launched from; never a running tool. */
const SHELLS = new Set(['bash', 'zsh', 'sh', 'fish', 'dash', 'ksh', 'login']);

export interface QuiescenceOptions {
	readonly terminal: AgentTerminalContext;
	readonly providerExecutable: string;
	readonly quietMs?: number;
	/** Injected for tests; defaults to a real, cancellable timer. */
	readonly wait?: (ms: number) => {
		promise: Promise<'elapsed'>;
		cancel(): void;
	};
}

/**
 * True while a descendant other than the provider itself or the shell it was
 * launched from is running. Process evidence may only *suppress* the inference
 * — a long silent tool run is not a prompt — and never asserts a state.
 */
async function toolRunning(options: QuiescenceOptions): Promise<boolean> {
	try {
		const descendants =
			await options.terminal.observation.processes.descendants({
				signal: options.terminal.signal,
			});
		return descendants.some((process) => {
			const name = process.executableName?.trim().toLowerCase();
			if (!name) return false;
			return name !== options.providerExecutable && !SHELLS.has(name);
		});
	} catch {
		// An unavailable sample is not evidence that nothing is running, so
		// withhold the inference rather than assert a prompt that may not exist.
		return true;
	}
}

/**
 * Wraps a journal watcher so a quiet window inside an open turn surfaces as one
 * synthetic record. Any real append cancels the pending window, so an answered
 * prompt clears the inferred state on the provider's very next write.
 */
export function withQuiescence(
	inner: AgentFileWatcher | Promise<AgentFileWatcher>,
	options: QuiescenceOptions,
): AgentFileWatcher {
	const quietMs = options.quietMs ?? INPUT_REQUEST_WINDOW_MS;
	// The timer must never hold the process open on its own: a bound session
	// idles for minutes at a time and an active handle would keep Node alive.
	const wait =
		options.wait ??
		((ms: number) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const promise = new Promise<'elapsed'>((resolve) => {
				timer = setTimeout(() => resolve('elapsed'), ms);
				(timer as { unref?: () => void }).unref?.();
			});
			return { promise, cancel: () => clearTimeout(timer) };
		});
	let watcher: AgentFileWatcher | undefined;

	async function* iterate(): AsyncGenerator<AgentFileWatchChunk> {
		watcher = await inner;
		const iterator = watcher[Symbol.asyncIterator]();
		let pending: Promise<IteratorResult<AgentFileWatchChunk>> | undefined;
		let quiet = false;
		while (!options.terminal.signal.aborted) {
			pending ??= iterator.next();
			const timer = wait(quietMs);
			const settled = await Promise.race([
				pending.then((result) => ({ kind: 'chunk' as const, result })),
				timer.promise.then(() => ({ kind: 'quiet' as const })),
			]).finally(() => timer.cancel());
			if (settled.kind === 'quiet') {
				// One tick per quiet window. Repeating it would republish an
				// unchanged state on every timer.
				if (quiet) continue;
				if (await toolRunning(options)) continue;
				quiet = true;
				yield QUIET_CHUNK;
				continue;
			}
			pending = undefined;
			quiet = false;
			if (settled.result.done) return;
			yield settled.result.value;
		}
	}

	return {
		[Symbol.asyncIterator]: iterate,
		async dispose() {
			await watcher?.dispose();
		},
	};
}
