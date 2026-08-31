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

	shouldRecoverFromSilence(
		attempt: SessionConnectAttempt,
		stallClass?: 'inbound-stalled' | 'no-inbound',
	): boolean {
		if (stallClass !== 'inbound-stalled' && stallClass !== 'no-inbound') {
			return false;
		}
		return this.shouldRecoverFromClose(attempt);
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

export const SESSION_APPLICATION_STALL_MS = 3_000;

export type SessionApplicationStallClass = 'inbound-stalled' | 'no-inbound';

export function classifySessionApplicationSilence(
	input: Readonly<{
		inboundFrames: number;
		outboundFrames: number;
		lastInboundAt: number | null;
		lastOutboundAt: number | null;
		now: number;
		stallMs?: number;
	}>,
): SessionApplicationStallClass | undefined {
	const stallMs = input.stallMs ?? SESSION_APPLICATION_STALL_MS;
	if (input.outboundFrames < 1) return undefined;
	if (input.inboundFrames < 1) {
		if (
			input.lastOutboundAt === null ||
			input.now - input.lastOutboundAt < stallMs
		) {
			return undefined;
		}
		return 'no-inbound';
	}
	if (input.lastInboundAt === null || input.lastOutboundAt === null)
		return undefined;
	if (input.now - input.lastInboundAt < stallMs) return undefined;
	if (input.lastOutboundAt <= input.lastInboundAt) return undefined;
	return 'inbound-stalled';
}

export const SESSION_APPLICATION_SAMPLE_MS = 10_000;

export type SessionLaneSnapshot = Readonly<{
	inboundFrames: number;
	lastInboundAgeMs: number | null;
	lastOutboundAgeMs: number | null;
	outboundFrames: number;
	stallClass?: SessionApplicationStallClass;
}>;

export function logSessionLane(
	event: string,
	snapshot: SessionLaneSnapshot,
): void {
	console.warn('[terminay-workspace]', event, snapshot);
}

export function createSessionSilenceWatch(
	options: Readonly<{
		onSilence: (
			stallClass: SessionApplicationStallClass,
			snapshot: SessionLaneSnapshot,
		) => void;
		onSample?: (snapshot: SessionLaneSnapshot) => void;
		now?: () => number;
		setTimeout?: (callback: () => void, delayMs: number) => unknown;
		clearTimeout?: (handle: unknown) => void;
		stallMs?: number;
		sampleMs?: number;
	}>,
): Readonly<{
	noteInbound(): void;
	noteOutbound(): void;
	snapshot(): SessionLaneSnapshot;
	stop(): void;
}> {
	const now = options.now ?? Date.now;
	const stallMs = options.stallMs ?? SESSION_APPLICATION_STALL_MS;
	const sampleMs = options.sampleMs ?? SESSION_APPLICATION_SAMPLE_MS;
	const setTimer =
		options.setTimeout ??
		((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
	const clearTimer =
		options.clearTimeout ??
		((handle) => globalThis.clearTimeout(handle as number));
	let inboundFrames = 0;
	let outboundFrames = 0;
	let lastInboundAt: number | null = null;
	let lastOutboundAt: number | null = null;
	let timer: unknown;
	let sampleTimer: unknown;
	let stopped = false;
	let notified = false;

	const snapshot = (): SessionLaneSnapshot => {
		const current = now();
		const stallClass = classifySessionApplicationSilence({
			inboundFrames,
			outboundFrames,
			lastInboundAt,
			lastOutboundAt,
			now: current,
			stallMs,
		});
		return {
			inboundFrames,
			outboundFrames,
			lastInboundAgeMs:
				lastInboundAt === null ? null : Math.max(0, current - lastInboundAt),
			lastOutboundAgeMs:
				lastOutboundAt === null ? null : Math.max(0, current - lastOutboundAt),
			...(stallClass === undefined ? {} : { stallClass }),
		};
	};

	const check = (): void => {
		if (stopped || notified) return;
		const next = snapshot();
		if (next.stallClass === undefined) return;
		notified = true;
		options.onSilence(next.stallClass, next);
	};

	const sample = (): void => {
		if (stopped) return;
		options.onSample?.(snapshot());
		sampleTimer = setTimer(sample, sampleMs);
	};

	const arm = (): void => {
		if (stopped || notified) return;
		if (timer !== undefined) clearTimer(timer);
		timer = setTimer(check, stallMs);
		if (sampleTimer === undefined && options.onSample !== undefined) {
			sampleTimer = setTimer(sample, sampleMs);
		}
	};

	return {
		noteInbound() {
			if (stopped || notified) return;
			inboundFrames += 1;
			lastInboundAt = now();
			arm();
		},
		noteOutbound() {
			if (stopped || notified) return;
			outboundFrames += 1;
			lastOutboundAt = now();
			arm();
		},
		snapshot,
		stop() {
			if (stopped) return;
			stopped = true;
			if (timer !== undefined) clearTimer(timer);
			if (sampleTimer !== undefined) clearTimer(sampleTimer);
			timer = undefined;
			sampleTimer = undefined;
		},
	};
}

function positiveDelay(value: number | undefined, fallback: number): number {
	const result = value ?? fallback;
	if (!Number.isSafeInteger(result) || result <= 0) {
		throw new Error('session connect deadline must be a positive integer');
	}
	return result;
}
