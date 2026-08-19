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
		const timeoutMs = positiveDelay(clock.attemptTimeoutMs, DEFAULT_ATTEMPT_TIMEOUT_MS);
		return new Promise<Value>((resolve, reject) => {
			const timer = clock.setTimeout(() => {
				reject(
					new Error(
						`Session connect timed out after ${timeoutMs}ms.`,
					),
				);
			}, timeoutMs);
			operation.then(
				(value) => {
					clock.clearTimeout(timer);
					if (!this.isCurrent(attempt)) {
						reject(new Error('Session connect belongs to a retired generation.'));
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

function positiveDelay(value: number | undefined, fallback: number): number {
	const result = value ?? fallback;
	if (!Number.isSafeInteger(result) || result <= 0) {
		throw new Error('session connect deadline must be a positive integer');
	}
	return result;
}
