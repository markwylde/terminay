export type RendererConnectionRecoveryPhase =
	| 'connected'
	| 'reconnecting'
	| 'resubscribing'
	| 'hydrating'
	| 'failed';

export type RendererConnectionRecoveryAttempt = Readonly<{
	generation: number;
	key: string;
	signal: AbortSignal;
}>;

export type RendererConnectionRecoveryState = Readonly<{
	attempt: number;
	error?: unknown;
	generation: number;
	key?: string;
	nextRetryMs?: number;
	phase: RendererConnectionRecoveryPhase;
}>;

export type RendererConnectionRecoveryClock = Readonly<{
	clearTimeout(handle: unknown): void;
	setTimeout(callback: () => void, delayMs: number): unknown;
}>;

export type RendererConnectionRecoveryOptions<Context> = Readonly<{
	clock?: RendererConnectionRecoveryClock;
	connect(attempt: RendererConnectionRecoveryAttempt): Promise<Context>;
	dispose(context: Context): void | Promise<void>;
	hydrate(
		context: Context,
		attempt: RendererConnectionRecoveryAttempt,
	): Promise<void>;
	initialRetryMs?: number;
	maxRetryMs?: number;
	onRecovered(
		context: Context,
		attempt: RendererConnectionRecoveryAttempt,
	): void | PromiseLike<void>;
	onStateChange?(state: RendererConnectionRecoveryState): void;
	resubscribe(
		context: Context,
		attempt: RendererConnectionRecoveryAttempt,
	): Promise<void>;
}>;

const defaultClock: RendererConnectionRecoveryClock = {
	clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
	setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
};

/**
 * Host-neutral orchestration for replacing a failed renderer connection.
 * Transport acquisition and feature hydration remain host-owned; this class
 * only enforces ordering, retry policy, and generation ownership.
 */
export class RendererConnectionRecovery<Context> {
	private readonly options: RendererConnectionRecoveryOptions<Context>;
	private readonly clock: RendererConnectionRecoveryClock;
	private readonly initialRetryMs: number;
	private readonly maxRetryMs: number;
	private generation = 0;
	private failures = 0;
	private key: string | undefined;
	private controller: AbortController | undefined;
	private retryTimer: unknown;
	private running = false;
	private pendingStart = false;
	private stateValue: RendererConnectionRecoveryState = Object.freeze({
		attempt: 0,
		generation: 0,
		phase: 'connected',
	});

	constructor(options: RendererConnectionRecoveryOptions<Context>) {
		this.options = options;
		this.clock = options.clock ?? defaultClock;
		this.initialRetryMs = positiveDelay(options.initialRetryMs, 250);
		this.maxRetryMs = positiveDelay(options.maxRetryMs, 10_000);
		if (this.initialRetryMs > this.maxRetryMs) {
			throw new Error('initial retry delay cannot exceed maximum retry delay');
		}
	}

	get state(): RendererConnectionRecoveryState {
		return this.stateValue;
	}

	start(key: string): void {
		if (key.length === 0) throw new Error('connection recovery key is required');
		this.replaceGeneration(key, true);
	}

	retry(): void {
		if (this.key === undefined) return;
		this.replaceGeneration(this.key, false);
	}

	cancel(): void {
		this.generation += 1;
		this.key = undefined;
		this.failures = 0;
		this.pendingStart = false;
		this.controller?.abort();
		this.controller = undefined;
		this.clearRetry();
		this.publish({
			attempt: 0,
			generation: this.generation,
			phase: 'connected',
		});
	}

	private replaceGeneration(key: string, resetFailures: boolean): void {
		this.generation += 1;
		this.key = key;
		if (resetFailures) this.failures = 0;
		this.pendingStart = true;
		this.controller?.abort();
		this.clearRetry();
		this.publish({
			attempt: this.failures + 1,
			generation: this.generation,
			key,
			phase: 'reconnecting',
		});
		this.drain();
	}

	private drain(): void {
		if (this.running || !this.pendingStart || this.key === undefined) return;
		this.pendingStart = false;
		this.running = true;
		const generation = this.generation;
		const key = this.key;
		const controller = new AbortController();
		this.controller = controller;
		const attempt = Object.freeze({
			generation,
			key,
			signal: controller.signal,
		});
		void this.run(attempt).finally(() => {
			this.running = false;
			if (this.controller === controller) this.controller = undefined;
			this.drain();
		});
	}

	private async run(attempt: RendererConnectionRecoveryAttempt): Promise<void> {
		let context: Context | undefined;
		let published = false;
		try {
			context = await this.options.connect(attempt);
			if (!this.isCurrent(attempt)) return;
			this.publishPhase('resubscribing', attempt);
			await this.options.resubscribe(context, attempt);
			if (!this.isCurrent(attempt)) return;
			this.publishPhase('hydrating', attempt);
			await this.options.hydrate(context, attempt);
			if (!this.isCurrent(attempt)) return;
			await this.options.onRecovered(context, attempt);
			if (!this.isCurrent(attempt)) return;
			published = true;
			this.failures = 0;
			this.publish({
				attempt: 0,
				generation: attempt.generation,
				key: attempt.key,
				phase: 'connected',
			});
		} catch (error) {
			if (this.isCurrent(attempt)) this.scheduleRetry(attempt, error);
		} finally {
			if (context !== undefined && !published) {
				await Promise.resolve(this.options.dispose(context)).catch(() => undefined);
			}
		}
	}

	private scheduleRetry(
		attempt: RendererConnectionRecoveryAttempt,
		error: unknown,
	): void {
		this.failures += 1;
		const delay = Math.min(
			this.maxRetryMs,
			this.initialRetryMs * 2 ** Math.min(this.failures - 1, 30),
		);
		this.publish({
			attempt: this.failures,
			error,
			generation: attempt.generation,
			key: attempt.key,
			nextRetryMs: delay,
			phase: 'failed',
		});
		this.retryTimer = this.clock.setTimeout(() => {
			this.retryTimer = undefined;
			if (!this.isCurrent(attempt)) return;
			this.pendingStart = true;
			this.publishPhase('reconnecting', attempt, this.failures + 1);
			this.drain();
		}, delay);
	}

	private isCurrent(attempt: RendererConnectionRecoveryAttempt): boolean {
		return (
			!attempt.signal.aborted &&
			attempt.generation === this.generation &&
			attempt.key === this.key
		);
	}

	private publishPhase(
		phase: RendererConnectionRecoveryPhase,
		attempt: RendererConnectionRecoveryAttempt,
		attemptNumber = this.failures + 1,
	): void {
		this.publish({
			attempt: attemptNumber,
			generation: attempt.generation,
			key: attempt.key,
			phase,
		});
	}

	private publish(state: RendererConnectionRecoveryState): void {
		this.stateValue = Object.freeze(state);
		this.options.onStateChange?.(this.stateValue);
	}

	private clearRetry(): void {
		if (this.retryTimer === undefined) return;
		this.clock.clearTimeout(this.retryTimer);
		this.retryTimer = undefined;
	}
}

function positiveDelay(value: number | undefined, fallback: number): number {
	const result = value ?? fallback;
	if (!Number.isSafeInteger(result) || result <= 0) {
		throw new Error('connection recovery delays must be positive integers');
	}
	return result;
}
