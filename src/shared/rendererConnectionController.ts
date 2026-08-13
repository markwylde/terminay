export type RendererConnectionPhase =
	| 'idle'
	| 'connecting'
	| 'authenticating'
	| 'resubscribing'
	| 'hydrating'
	| 'connected'
	| 'retry-wait'
	| 'blocked'
	| 'stopped';

export type RendererConnectionFailureReason =
	| 'offline'
	| 'relay'
	| 'route'
	| 'revoked'
	| 'expired'
	| 'exposure-stopped'
	| 'explicit-disconnect'
	| 'forgotten'
	| 'host-shutdown';

export type RendererConnectionFailure = Readonly<{
	disposition: 'retryable' | 'blocked' | 'stopped';
	reason: RendererConnectionFailureReason;
}>;

export type RendererConnectionState = Readonly<{
	attempt: number;
	error?: unknown;
	generation: number;
	nextRetryMs?: number;
	phase: RendererConnectionPhase;
	profileId?: string;
	reason?: RendererConnectionFailureReason;
}>;

export type RendererConnectionAttempt = Readonly<{
	attempt: number;
	generation: number;
	profileId: string;
	signal: AbortSignal;
}>;

export type RendererConnectionClock = Readonly<{
	clearTimeout(handle: unknown): void;
	setTimeout(callback: () => void, delayMs: number): unknown;
}>;

export type RendererConnectionPipeline<Candidate> = Readonly<{
	acquire(attempt: RendererConnectionAttempt): Promise<Candidate>;
	authenticate?(candidate: Candidate, attempt: RendererConnectionAttempt): Promise<void>;
	resubscribe(candidate: Candidate, attempt: RendererConnectionAttempt): Promise<void>;
	hydrate(candidate: Candidate, attempt: RendererConnectionAttempt): Promise<void>;
	verify(candidate: Candidate, attempt: RendererConnectionAttempt): Promise<void>;
}>;

type Disposable = { readonly dispose?: () => void | Promise<void> };

export type RendererConnectionControllerOptions<Candidate extends Disposable> = Readonly<{
	clock?: RendererConnectionClock;
	classifyFailure?(error: unknown): RendererConnectionFailure;
	dispose?(candidate: Candidate): void | Promise<void>;
	initialRetryMs?: number;
	attemptTimeoutMs?: number;
	maxRetryMs?: number;
	onActivated?(candidate: Candidate, state: RendererConnectionState): void | Promise<void>;
	onCandidate?(candidate: Candidate, state: RendererConnectionState): void | Promise<void>;
	onStateChange?(state: RendererConnectionState): void;
}>;

const defaultClock: RendererConnectionClock = {
	clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
	setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
};

/**
 * The only renderer owner of connection identity, retry intent, candidate
 * activation and stale-attempt fencing. Transport providers are injected as a
 * pipeline; they never own renderer lifecycle or UI state.
 */
export class RendererConnectionController<Candidate extends Disposable> {
	private readonly clock: RendererConnectionClock;
	private readonly initialRetryMs: number;
	private readonly attemptTimeoutMs: number;
	private readonly maxRetryMs: number;
	private readonly listeners = new Set<(state: RendererConnectionState) => void>();
	private generation = 0;
	private failures = 0;
	private controller: AbortController | undefined;
	private retryTimer: unknown;
	private pipeline: RendererConnectionPipeline<Candidate> | undefined;
	private active: Candidate | undefined;
	private retirement: Promise<void> = Promise.resolve();
	private candidate: Candidate | undefined;
	private running = false;
	private pending = false;
	private stateValue: RendererConnectionState = Object.freeze({
		attempt: 0,
		generation: 0,
		phase: 'idle',
	});

	readonly retry = (): void => {
		if (this.stateValue.profileId === undefined || this.pipeline === undefined) return;
		// The host may already have handed a fresh endpoint to an acquisition that
		// cannot be synchronously cancelled. Retrying while that attempt is active
		// would orphan the only usable endpoint and start a competing generation.
		// Manual Retry is an acceleration of retry-wait, never supersession of an
		// in-flight connecting/authenticating/hydrating attempt.
		if (this.stateValue.phase !== 'retry-wait') return;
		this.startAttempt(false);
	};

	constructor(private readonly options: RendererConnectionControllerOptions<Candidate> = {}) {
		this.clock = options.clock ?? defaultClock;
		this.initialRetryMs = positiveDelay(options.initialRetryMs, 750);
		this.attemptTimeoutMs = positiveDelay(options.attemptTimeoutMs, 30_000);
		this.maxRetryMs = positiveDelay(options.maxRetryMs, 10_000);
		if (this.initialRetryMs > this.maxRetryMs)
			throw new Error('initial retry delay cannot exceed maximum retry delay');
	}

	get state(): RendererConnectionState { return this.stateValue; }
	get current(): Candidate | undefined { return this.active; }

	subscribe(listener: (state: RendererConnectionState) => void): () => void {
		this.listeners.add(listener);
		listener(this.stateValue);
		return () => this.listeners.delete(listener);
	}

	/** Begin an externally acquired initial/pairing attempt. The returned token
	 * is owned by this controller and is the only authority allowed to publish
	 * the eventual fully-hydrated candidate. */
	begin(profileId: string): RendererConnectionAttempt {
		if (profileId.length === 0) throw new Error('stable profile id is required');
		this.generation += 1;
		this.controller?.abort();
		this.clearRetry();
		const controller = new AbortController();
		this.controller = controller;
		this.publish({ attempt: 1, generation: this.generation, phase: 'connecting', profileId });
		return Object.freeze({ attempt: 1, generation: this.generation, profileId, signal: controller.signal });
	}

	isCurrent(attempt: RendererConnectionAttempt): boolean {
		return this.isCurrentAttempt(attempt, undefined);
	}

	async activate(attempt: RendererConnectionAttempt, candidate: Candidate): Promise<boolean> {
		if (!this.isCurrent(attempt)) {
			await this.dispose(candidate);
			return false;
		}
		const previous = this.active;
		this.active = candidate;
		if (previous !== undefined && previous !== candidate) await this.dispose(previous);
		if (!this.isCurrent(attempt)) {
			if (this.active === candidate) this.active = undefined;
			await this.dispose(candidate);
			return false;
		}
		const state = Object.freeze({ attempt: 0, generation: attempt.generation, phase: 'connected' as const, profileId: attempt.profileId });
		this.publish(state);
		await this.options.onActivated?.(candidate, state);
		return true;
	}

	connect(profileId: string, pipeline: RendererConnectionPipeline<Candidate>): void {
		if (profileId.length === 0) throw new Error('stable profile id is required');
		const switchingProfile = this.stateValue.profileId !== profileId;
		this.pipeline = pipeline;
		this.failures = 0;
		if (switchingProfile) this.queueActiveRetirement();
		this.publish({ attempt: 1, generation: this.generation, phase: 'connecting', profileId });
		this.startAttempt(true);
	}

	setRecoveryPipeline(profileId: string, pipeline: RendererConnectionPipeline<Candidate>): void {
		if (profileId !== this.stateValue.profileId)
			throw new Error('recovery pipeline must target the current stable profile');
		this.pipeline = pipeline;
	}

	recover(profileId: string): void {
		if (profileId !== this.stateValue.profileId || this.pipeline === undefined) return;
		if (this.stateValue.phase !== 'connected') return;
		this.queueActiveRetirement();
		this.startAttempt(true);
	}

	async stop(profileId?: string, reason: Extract<RendererConnectionFailureReason, 'explicit-disconnect' | 'forgotten' | 'host-shutdown'> = 'explicit-disconnect'): Promise<void> {
		if (profileId !== undefined && profileId !== this.stateValue.profileId) return;
		this.generation += 1;
		this.controller?.abort();
		this.controller = undefined;
		this.clearRetry();
		this.pending = false;
		this.pipeline = undefined;
		await this.retireCandidate();
		await this.retireActive();
		await this.retirement;
		this.publish({ attempt: 0, generation: this.generation, phase: 'stopped', reason });
	}

	private startAttempt(resetFailures: boolean): void {
		const profileId = this.stateValue.profileId;
		if (profileId === undefined || this.pipeline === undefined) return;
		if (resetFailures) this.failures = 0;
		this.generation += 1;
		this.controller?.abort();
		this.clearRetry();
		this.pending = true;
		this.publish({ attempt: this.failures + 1, generation: this.generation, phase: 'connecting', profileId });
		this.drain();
	}

	private drain(): void {
		if (this.running || !this.pending || this.pipeline === undefined) return;
		this.pending = false;
		this.running = true;
		const controller = new AbortController();
		this.controller = controller;
		const attempt = Object.freeze({
			attempt: this.failures + 1,
			generation: this.generation,
			profileId: this.stateValue.profileId!,
			signal: controller.signal,
		});
		const pipeline = this.pipeline;
		void this.run(attempt, pipeline, controller).finally(() => {
			this.running = false;
			if (this.controller === controller) this.controller = undefined;
			this.drain();
		});
	}

	private async run(attempt: RendererConnectionAttempt, pipeline: RendererConnectionPipeline<Candidate>, controller: AbortController): Promise<void> {
		let candidate: Candidate | undefined;
		let rejectDeadline!: (reason: unknown) => void;
		const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; });
		const deadlineTimer = this.clock.setTimeout(
			() => {
				const error = new Error(`connection generation timed out after ${this.attemptTimeoutMs}ms`);
				// Cancel every transport operation owned by this generation as its
				// deadline expires. The generation remains the lifecycle owner long
				// enough for the catch path to publish retry-wait.
				controller.abort(error);
				rejectDeadline(error);
			},
			this.attemptTimeoutMs,
		);
		const bounded = <Value>(operation: Promise<Value>): Promise<Value> =>
			Promise.race([operation, deadline]);
		try {
			// A stable client id cannot overlap generations: a late close from the
			// retired protocol client can otherwise unregister the replacement after
			// its handshake. Finish old context/client disposal before acquisition.
			await bounded(this.retirement);
			if (!this.isCurrentAttempt(attempt, pipeline)) return;
			candidate = await bounded(pipeline.acquire(attempt));
			this.candidate = candidate;
			if (!this.isCurrentAttempt(attempt, pipeline)) return;
			this.publishPhase('authenticating', attempt);
			await bounded(pipeline.authenticate?.(candidate, attempt) ?? Promise.resolve());
			if (!this.isCurrentAttempt(attempt, pipeline)) return;
			this.publishPhase('resubscribing', attempt);
			await bounded(pipeline.resubscribe(candidate, attempt));
			if (!this.isCurrentAttempt(attempt, pipeline)) return;
			this.publishPhase('hydrating', attempt);
			await bounded(pipeline.hydrate(candidate, attempt));
			if (!this.isCurrentAttempt(attempt, pipeline)) return;
			await bounded(Promise.resolve(this.options.onCandidate?.(candidate, this.stateValue)));
			if (!this.isCurrentAttempt(attempt, pipeline)) return;
			await bounded(pipeline.verify(candidate, attempt));
			if (!this.isCurrentAttempt(attempt, pipeline)) return;
			const previous = this.active;
			this.active = candidate;
			this.candidate = undefined;
			if (previous !== undefined && previous !== candidate) await this.dispose(previous);
			if (!this.isCurrentAttempt(attempt, pipeline)) {
				if (this.active === candidate) this.active = undefined;
				await this.dispose(candidate);
				return;
			}
			this.failures = 0;
			const state = Object.freeze({ attempt: 0, generation: attempt.generation, phase: 'connected' as const, profileId: attempt.profileId });
			this.publish(state);
			await this.options.onActivated?.(candidate, state);
		} catch (error) {
			if (this.isOwnedAttempt(attempt, pipeline)) this.handleFailure(attempt, error);
		} finally {
			this.clock.clearTimeout(deadlineTimer);
			if (candidate !== undefined && candidate !== this.active) {
				if (this.candidate === candidate) this.candidate = undefined;
				await this.dispose(candidate);
			}
		}
	}

	private scheduleRetry(attempt: RendererConnectionAttempt, error: unknown): void {
		const failure = this.options.classifyFailure?.(error) ?? Object.freeze({ disposition: 'retryable' as const, reason: 'offline' as const });
		this.failures += 1;
		const delay = Math.min(this.maxRetryMs, this.initialRetryMs * 2 ** Math.min(this.failures - 1, 30));
		this.publish({ attempt: this.failures, error, generation: attempt.generation, nextRetryMs: delay, phase: 'retry-wait', profileId: attempt.profileId, reason: failure.reason });
		this.retryTimer = this.clock.setTimeout(() => {
			this.retryTimer = undefined;
			if (!this.isCurrentAttempt(attempt, this.pipeline)) return;
			this.startAttempt(false);
		}, delay);
	}

	private handleFailure(attempt: RendererConnectionAttempt, error: unknown): void {
		const failure = this.options.classifyFailure?.(error) ?? Object.freeze({ disposition: 'retryable' as const, reason: 'offline' as const });
		if (failure.disposition === 'retryable') {
			this.scheduleRetry(attempt, error);
			return;
		}
		this.clearRetry();
		this.publish({
			attempt: this.failures + 1,
			error,
			generation: attempt.generation,
			phase: failure.disposition,
			profileId: attempt.profileId,
			reason: failure.reason,
		});
	}

	private isCurrentAttempt(attempt: RendererConnectionAttempt, pipeline: RendererConnectionPipeline<Candidate> | undefined): boolean {
		return !attempt.signal.aborted && this.isOwnedAttempt(attempt, pipeline);
	}

	private isOwnedAttempt(attempt: RendererConnectionAttempt, pipeline: RendererConnectionPipeline<Candidate> | undefined): boolean {
		return attempt.generation === this.generation && attempt.profileId === this.stateValue.profileId && (pipeline === undefined || pipeline === this.pipeline);
	}

	private publishPhase(phase: RendererConnectionPhase, attempt: RendererConnectionAttempt): void {
		this.publish({ attempt: attempt.attempt, generation: attempt.generation, phase, profileId: attempt.profileId });
	}

	private publish(state: RendererConnectionState): void {
		this.stateValue = Object.freeze(state);
		this.options.onStateChange?.(this.stateValue);
		for (const listener of this.listeners) listener(this.stateValue);
	}

	private async retireCandidate(): Promise<void> {
		const candidate = this.candidate;
		this.candidate = undefined;
		if (candidate !== undefined) await this.dispose(candidate);
	}

	private async retireActive(): Promise<void> {
		const active = this.active;
		this.active = undefined;
		if (active !== undefined) await this.dispose(active);
	}

	private queueActiveRetirement(): void {
		const active = this.active;
		this.active = undefined;
		if (active === undefined) return;
		this.retirement = this.retirement.then(() => this.dispose(active));
	}

	private async dispose(candidate: Candidate): Promise<void> {
		await Promise.resolve(this.options.dispose?.(candidate) ?? candidate.dispose?.()).catch(() => undefined);
	}

	private clearRetry(): void {
		if (this.retryTimer === undefined) return;
		this.clock.clearTimeout(this.retryTimer);
		this.retryTimer = undefined;
	}
}

function positiveDelay(value: number | undefined, fallback: number): number {
	const result = value ?? fallback;
	if (!Number.isSafeInteger(result) || result <= 0)
		throw new Error('connection retry delays must be positive integers');
	return result;
}
