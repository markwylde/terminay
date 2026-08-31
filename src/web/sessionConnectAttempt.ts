export type SessionConnectAttempt = Readonly<{
	generation: number;
}>;

export type SessionConnectClock = Readonly<{
	attemptTimeoutMs?: number;
	clearTimeout(handle: unknown): void;
	setTimeout(callback: () => void, delayMs: number): unknown;
}>;

const DEFAULT_ATTEMPT_TIMEOUT_MS = 20_000;

const defaultClock: SessionConnectClock = {
	clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
	setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
};

/**
 * One in-flight workspace connect covering first mount, automatic recovery,
 * and Retry. Stale generation closes cannot start a competing join.
 */
export class SessionConnectGate {
	private generation = 0;
	private inFlightGeneration: number | undefined;

	get inFlight(): boolean {
		return this.inFlightGeneration !== undefined;
	}

	get currentGeneration(): number {
		return this.generation;
	}

	begin(): SessionConnectAttempt | undefined {
		if (this.inFlightGeneration !== undefined) return undefined;
		this.generation += 1;
		this.inFlightGeneration = this.generation;
		return Object.freeze({ generation: this.generation });
	}

	isCurrent(attempt: SessionConnectAttempt): boolean {
		return attempt.generation === this.generation;
	}

	shouldRecoverFromClose(attempt: SessionConnectAttempt): boolean {
		return this.isCurrent(attempt) && this.inFlightGeneration === undefined;
	}

	finish(attempt: SessionConnectAttempt): void {
		if (this.inFlightGeneration === attempt.generation) {
			this.inFlightGeneration = undefined;
		}
	}

	withDeadline<Value>(
		attempt: SessionConnectAttempt,
		operation: Promise<Value>,
		clock: SessionConnectClock = defaultClock,
	): Promise<Value> {
		const timeoutMs = positiveDelay(
			clock.attemptTimeoutMs,
			DEFAULT_ATTEMPT_TIMEOUT_MS,
		);
		return new Promise<Value>((resolve, reject) => {
			const timer = clock.setTimeout(() => {
				reject(new Error(`Session connect timed out after ${timeoutMs}ms.`));
			}, timeoutMs);
			operation.then(
				(value) => {
					clock.clearTimeout(timer);
					if (!this.isCurrent(attempt)) {
						reject(
							new Error('Session connect belongs to a retired generation.'),
						);
						return;
					}
					resolve(value);
				},
				(error) => {
					clock.clearTimeout(timer);
					reject(error);
				},
			);
		});
	}
}

export const SESSION_HEARTBEAT_INTERVAL_MS = 10_000;
/** Two consecutive missed responses retire the generation. */
export const SESSION_HEARTBEAT_MISS_LIMIT = 2;

export type SessionHeartbeatSnapshot = Readonly<{
	sent: number;
	missed: number;
	lastRoundTripMs: number | null;
}>;

export function logSessionLane(
	event: string,
	snapshot: SessionHeartbeatSnapshot,
): void {
	console.warn('[terminay-workspace]', event, snapshot);
}

/**
 * Prove the connection is alive by asking it, not by watching traffic.
 *
 * A WebRTC generation can stop delivering while every lane still reports
 * `open`. Quiet output is indistinguishable from a dead transport unless the
 * client asks a question and requires an answer, so that is all this does.
 */
export function createSessionHeartbeat(
	options: Readonly<{
		ping: (signal: AbortSignal) => Promise<unknown>;
		onLost: (snapshot: SessionHeartbeatSnapshot) => void;
		onSample?: (snapshot: SessionHeartbeatSnapshot) => void;
		intervalMs?: number;
		missLimit?: number;
		now?: () => number;
		setTimeout?: (callback: () => void, delayMs: number) => unknown;
		clearTimeout?: (handle: unknown) => void;
	}>,
): Readonly<{ start(): void; stop(): void; snapshot(): SessionHeartbeatSnapshot }> {
	const intervalMs = options.intervalMs ?? SESSION_HEARTBEAT_INTERVAL_MS;
	const missLimit = options.missLimit ?? SESSION_HEARTBEAT_MISS_LIMIT;
	const now = options.now ?? Date.now;
	const setTimer =
		options.setTimeout ??
		((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
	const clearTimer =
		options.clearTimeout ??
		((handle) => globalThis.clearTimeout(handle as number));
	let timer: unknown;
	let stopped = false;
	let lost = false;
	let sent = 0;
	let missed = 0;
	let lastRoundTripMs: number | null = null;

	const snapshot = (): SessionHeartbeatSnapshot =>
		Object.freeze({ sent, missed, lastRoundTripMs });

	const beat = async (): Promise<void> => {
		if (stopped || lost) return;
		sent += 1;
		const startedAt = now();
		// The interval doubles as the response deadline: a probe that has not
		// answered by the time the next one is due has already missed.
		const controller = new AbortController();
		const deadline = setTimer(() => controller.abort(), intervalMs);
		try {
			await options.ping(controller.signal);
			missed = 0;
			lastRoundTripMs = now() - startedAt;
		} catch {
			missed += 1;
		} finally {
			clearTimer(deadline);
		}
		if (stopped || lost) return;
		options.onSample?.(snapshot());
		if (missed >= missLimit) {
			lost = true;
			options.onLost(snapshot());
			return;
		}
		timer = setTimer(() => void beat(), intervalMs);
	};

	return {
		start() {
			if (stopped || timer !== undefined) return;
			timer = setTimer(() => void beat(), intervalMs);
		},
		stop() {
			if (stopped) return;
			stopped = true;
			if (timer !== undefined) clearTimer(timer);
			timer = undefined;
		},
		snapshot,
	};
}

function positiveDelay(value: number | undefined, fallback: number): number {
	const result = value ?? fallback;
	if (!Number.isSafeInteger(result) || result <= 0) {
		throw new Error('session connect deadline must be a positive integer');
	}
	return result;
}
