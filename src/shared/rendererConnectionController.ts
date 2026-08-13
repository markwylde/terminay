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

export type RendererConnectionState = Readonly<{
	attempt: number;
	error?: unknown;
	generation: number;
	nextRetryMs?: number;
	phase: RendererConnectionPhase;
	profileId?: string;
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
	dispose?(candidate: Candidate): void | Promise<void>;
	initialRetryMs?: number;
	maxRetryMs?: number;
	onActivated?(candidate: Candidate, state: RendererConnectionState): void | Promise<void>;
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
	private readonly maxRetryMs: number;
	private readonly listeners = new Set<(state: RendererConnectionState) => void>();
	private generation = 0;
	private failures = 0;
	private controller: AbortController | undefined;
	private retryTimer: unknown;
	private pipeline: RendererConnectionPipeline<Candidate> | undefined;
	private active: Candidate | undefined;
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
		this.startAttempt(false);
	};

	constructor(private readonly options: RendererConnectionControllerOptions<Candidate> = {}) {
		this.clock = options.clock ?? defaultClock;
		this.initialRetryMs = positiveDelay(options.initialRetryMs, 750);
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

	connect(profileId: string, pipeline: RendererConnectionPipeline<Candidate>): void {
		if (profileId.length === 0) throw new Error('stable profile id is required');
		const switchingProfile = this.stateValue.profileId !== profileId;
		this.pipeline = pipeline;
		this.failures = 0;
		if (switchingProfile) void this.retireActive();
		this.publish({ attempt: 1, generation: this.generation, phase: 'connecting', profileId });
		this.startAttempt(true);
	}

	recover(profileId: string): void {
		if (profileId !== this.stateValue.profileId || this.pipeline === undefined) return;
		void this.retireActive();
		this.startAttempt(true);
	}

	async stop(profileId?: string): Promise<void> {
		if (profileId !== undefined && profileId !== this.stateValue.profileId) return;
		this.generation += 1;
		this.controller?.abort();
		this.controller = undefined;
		this.clearRetry();
		this.pending = false;
		this.pipeline = undefined;
		await this.retireCandidate();
		await this.retireActive();
		this.publish({ attempt: 0, generation: this.generation, phase: 'stopped' });
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
		void this.run(attempt, pipeline).finally(() => {
			this.running = false;
			if (this.controller === controller) this.controller = undefined;
			this.drain();
		});
	}

	private async run(attempt: RendererConnectionAttempt, pipeline: RendererConnectionPipeline<Candidate>): Promise<void> {
		let candidate: Candidate | undefined;
		try {
			candidate = await pipeline.acquire(attempt);
			this.candidate = candidate;
			if (!this.isCurrent(attempt, pipeline)) return;
			this.publishPhase('authenticating', attempt);
			await pipeline.authenticate?.(candidate, attempt);
			if (!this.isCurrent(attempt, pipeline)) return;
			this.publishPhase('resubscribing', attempt);
			await pipeline.resubscribe(candidate, attempt);
			if (!this.isCurrent(attempt, pipeline)) return;
			this.publishPhase('hydrating', attempt);
			await pipeline.hydrate(candidate, attempt);
			if (!this.isCurrent(attempt, pipeline)) return;
			await pipeline.verify(candidate, attempt);
			if (!this.isCurrent(attempt, pipeline)) return;
			const previous = this.active;
			this.active = candidate;
			this.candidate = undefined;
			if (previous !== undefined && previous !== candidate) await this.dispose(previous);
			if (!this.isCurrent(attempt, pipeline)) {
				if (this.active === candidate) this.active = undefined;
				await this.dispose(candidate);
				return;
			}
			this.failures = 0;
			const state = Object.freeze({ attempt: 0, generation: attempt.generation, phase: 'connected' as const, profileId: attempt.profileId });
			this.publish(state);
			await this.options.onActivated?.(candidate, state);
		} catch (error) {
			if (this.isCurrent(attempt, pipeline)) this.scheduleRetry(attempt, error);
		} finally {
			if (candidate !== undefined && candidate !== this.active) {
				if (this.candidate === candidate) this.candidate = undefined;
				await this.dispose(candidate);
			}
		}
	}

	private scheduleRetry(attempt: RendererConnectionAttempt, error: unknown): void {
		this.failures += 1;
		const delay = Math.min(this.maxRetryMs, this.initialRetryMs * 2 ** Math.min(this.failures - 1, 30));
		this.publish({ attempt: this.failures, error, generation: attempt.generation, nextRetryMs: delay, phase: 'retry-wait', profileId: attempt.profileId });
		this.retryTimer = this.clock.setTimeout(() => {
			this.retryTimer = undefined;
			if (!this.isCurrent(attempt, this.pipeline)) return;
			this.startAttempt(false);
		}, delay);
	}

	private isCurrent(attempt: RendererConnectionAttempt, pipeline: RendererConnectionPipeline<Candidate> | undefined): boolean {
		return !attempt.signal.aborted && attempt.generation === this.generation && attempt.profileId === this.stateValue.profileId && pipeline === this.pipeline;
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
