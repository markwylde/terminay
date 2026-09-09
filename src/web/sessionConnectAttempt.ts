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

export const RECOVERY_BASE_DELAY_MS = 1_000;
export const RECOVERY_CEILING_DELAY_MS = 30_000;
/** Jitter is subtracted, so a delay is never longer than its step. */
export const RECOVERY_JITTER_RATIO = 0.25;

export type RecoveryScheduleOptions = Readonly<{
	baseDelayMs?: number;
	ceilingDelayMs?: number;
	jitterRatio?: number;
	random?: () => number;
	isHidden?: () => boolean;
	clearTimeout?: (handle: unknown) => void;
	setTimeout?: (callback: () => void, delayMs: number) => unknown;
}>;

/**
 * Bounded backoff for repeated recovery attempts.
 *
 * A session that cannot reach its server holds one slow attempt loop rather
 * than stopping: the phone that was put down for an hour has to find its way
 * back on its own. Attempts pause while the document is hidden, because a
 * frozen document cannot run them anyway, and resume when it is shown again.
 */
export class RecoveryRetrySchedule {
	private readonly baseDelayMs: number;
	private readonly ceilingDelayMs: number;
	private readonly jitterRatio: number;
	private readonly random: () => number;
	private readonly isHidden: () => boolean;
	private readonly setTimer: (callback: () => void, delayMs: number) => unknown;
	private readonly clearTimer: (handle: unknown) => void;
	private failures = 0;
	private timer: unknown;
	private deferred = false;
	private pending:
		| Readonly<{ run: () => void; isCurrent: () => boolean }>
		| undefined;

	constructor(options: RecoveryScheduleOptions = {}) {
		this.baseDelayMs = positiveDelay(
			options.baseDelayMs,
			RECOVERY_BASE_DELAY_MS,
		);
		this.ceilingDelayMs = positiveDelay(
			options.ceilingDelayMs,
			RECOVERY_CEILING_DELAY_MS,
		);
		if (this.ceilingDelayMs < this.baseDelayMs)
			throw new Error('recovery ceiling must not be below the base delay');
		const jitterRatio = options.jitterRatio ?? RECOVERY_JITTER_RATIO;
		if (!(jitterRatio >= 0 && jitterRatio < 1))
			throw new Error('recovery jitter ratio must be within [0, 1)');
		this.jitterRatio = jitterRatio;
		this.random = options.random ?? Math.random;
		this.isHidden = options.isHidden ?? (() => false);
		this.setTimer =
			options.setTimeout ??
			((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
		this.clearTimer =
			options.clearTimeout ??
			((handle) => globalThis.clearTimeout(handle as number));
	}

	get consecutiveFailures(): number {
		return this.failures;
	}

	/** True while an attempt is waiting for its delay or for the document. */
	get armed(): boolean {
		return this.pending !== undefined;
	}

	/** True when the delay elapsed while hidden and the attempt is held back. */
	get waitingForVisibility(): boolean {
		return this.deferred;
	}

	delayFor(failureCount: number): number {
		const step = Math.min(
			this.ceilingDelayMs,
			this.baseDelayMs * 2 ** Math.max(0, failureCount - 1),
		);
		return Math.round(step * (1 - this.jitterRatio * this.random()));
	}

	/** Arm the next attempt. `isCurrent` is consulted when the delay elapses. */
	arm(run: () => void, isCurrent: () => boolean = () => true): number {
		this.cancel();
		this.failures += 1;
		const delayMs = this.delayFor(this.failures);
		this.pending = Object.freeze({ run, isCurrent });
		this.timer = this.setTimer(() => {
			this.timer = undefined;
			this.fire();
		}, delayMs);
		return delayMs;
	}

	/** The document became visible: run an attempt that its delay already freed. */
	resume(): boolean {
		if (!this.deferred) return false;
		this.deferred = false;
		return this.fire();
	}

	cancel(): void {
		if (this.timer !== undefined) this.clearTimer(this.timer);
		this.timer = undefined;
		this.pending = undefined;
		this.deferred = false;
	}

	/** A connection was established: the next failure starts from the base delay. */
	reset(): void {
		this.cancel();
		this.failures = 0;
	}

	private fire(): boolean {
		const pending = this.pending;
		if (pending === undefined) return false;
		if (!pending.isCurrent()) {
			this.cancel();
			return false;
		}
		if (this.isHidden()) {
			this.deferred = true;
			return false;
		}
		this.pending = undefined;
		this.deferred = false;
		pending.run();
		return true;
	}
}

/**
 * Failures a further attempt cannot fix. These need a person, and retrying
 * them forever would hide that behind a spinner.
 */
export function isUnrecoverableConnectFailure(cause: unknown): boolean {
	const message = (
		cause instanceof Error ? cause.message : String(cause ?? '')
	).toLowerCase();
	return (
		message.includes('has not been paired') ||
		message.includes('host identity changed') ||
		message.includes('re-pairing is required') ||
		message.includes('revoked') ||
		message.includes('unknown device') ||
		message.includes('not trusted')
	);
}

export type RecoveryLoopPhase = 'connecting' | 'reconnecting' | 'ready';

export type RecoveryLoopRunOptions = Readonly<{
	replaceDesktopEndpoint?: boolean;
}>;

/**
 * One persistent connect loop for the workspace session.
 *
 * A single failed attempt is not an answer. First mount, automatic recovery,
 * and Retry all enter here; a failure schedules the next attempt itself and
 * keeps the reconnecting state visible while it waits, so the session comes
 * back without anyone touching it.
 */
export function createRecoveryLoop(
	options: Readonly<{
		run(
			attempt: SessionConnectAttempt,
			runOptions: RecoveryLoopRunOptions,
		): Promise<void>;
		/** True once this session has been connected at least once. */
		recovering(): boolean;
		onAttemptStart(context: Readonly<{ recovering: boolean }>): void;
		onAttemptFailed(
			context: Readonly<{ message: string; retrying: boolean }>,
		): void;
		attemptClock?: SessionConnectClock;
		schedule?: RecoveryRetrySchedule;
	}>,
): Readonly<{
	gate: SessionConnectGate;
	schedule: RecoveryRetrySchedule;
	start(runOptions?: RecoveryLoopRunOptions): void;
	resume(): void;
	dispose(): void;
}> {
	const gate = new SessionConnectGate();
	const schedule = options.schedule ?? new RecoveryRetrySchedule();
	// Recovering means the session has been connected at some point, not that a
	// connection record exists right now. A failed attempt clears the host's
	// record, and deciding from that alone presented every later attempt as a
	// cold connect: the surface flipped between two panels on each retry.
	let succeededOnce = false;

	const start = (runOptions: RecoveryLoopRunOptions = {}): void => {
		const attempt = gate.begin();
		if (attempt === undefined) return;
		// Retry means attempt now: a pending delay never outranks a fresh start.
		schedule.cancel();
		options.onAttemptStart({
			recovering: succeededOnce || options.recovering(),
		});
		void (async () => {
			let failure: unknown;
			try {
				await gate.withDeadline(
					attempt,
					options.run(attempt, runOptions),
					options.attemptClock,
				);
			} catch (cause) {
				failure = cause ?? new Error('Unable to reconnect.');
			}
			gate.finish(attempt);
			if (failure === undefined) {
				succeededOnce = true;
				schedule.reset();
				return;
			}
			if (!gate.isCurrent(attempt)) return;
			const message =
				failure instanceof Error ? failure.message : 'Unable to reconnect.';
			if (isUnrecoverableConnectFailure(failure)) {
				schedule.cancel();
				options.onAttemptFailed({ message, retrying: false });
				return;
			}
			options.onAttemptFailed({ message, retrying: true });
			schedule.arm(
				() => start(runOptions),
				() => gate.isCurrent(attempt),
			);
		})();
	};

	return Object.freeze({
		gate,
		schedule,
		start,
		resume: () => {
			schedule.resume();
		},
		dispose: () => {
			schedule.cancel();
		},
	});
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
): Readonly<{
	start(): void;
	stop(): void;
	probeNow(): void;
	snapshot(): SessionHeartbeatSnapshot;
}> {
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
		/**
		 * Ask right now instead of waiting out the interval.
		 *
		 * A frozen document runs nothing, so on thaw the next probe is still
		 * mid-interval while the transport may already be dead. Waiting for that
		 * interval, and then for the miss limit, is most of why returning to the
		 * app feels broken. An answered probe changes nothing.
		 */
		probeNow() {
			if (stopped || lost) return;
			if (timer !== undefined) clearTimer(timer);
			timer = undefined;
			void beat();
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
