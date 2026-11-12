import type {
	BotStartupCode,
	BotStartupFailure,
	BotStartupStage,
} from '@terminay/protocol';
import { EngineCommandError } from './process.js';

/** Adapter `--check-runtime` exit statuses (sysexits.h). */
export const ADAPTER_EXIT_TEMPORARY = 75;
export const ADAPTER_EXIT_LASTING = 69;

/** Transport errors that mean the engine connection dropped mid-operation. A
 * refused or missing socket means the engine is down, which is not temporary. */
const DROPPED = new Set([
	'ECONNRESET',
	'EPIPE',
	'ECONNABORTED',
	'ERR_STREAM_PREMATURE_CLOSE',
]);

/**
 * A failure before task hand-over, classified from structured errors and exit
 * statuses only (ADR-0109). It deliberately is not an `EngineCommandError`, so
 * a temporary failure never gets the blocking `engine` cause.
 */
export class BotStartupError extends Error {
	constructor(
		readonly stage: BotStartupStage,
		readonly code: BotStartupCode,
		readonly temporary: boolean,
		message: string,
		/** The attempt's container-side cleanup could not be confirmed. */
		readonly cleanupUnconfirmed = false,
	) {
		super(message);
		this.name = 'BotStartupError';
	}
	/** The same failure, no longer retryable because cleanup is unconfirmed. */
	unconfirmed(): BotStartupError {
		return new BotStartupError(
			this.stage,
			this.code,
			false,
			`${this.message} Its relay could not be confirmed stopped.`,
			true,
		);
	}
	get failure(): BotStartupFailure {
		return { stage: this.stage, temporary: this.temporary, code: this.code };
	}
}

/** The temporary engine code for an error, or null when it is not temporary. */
export function temporaryEngineCode(
	error: unknown,
): 'engine-deadline' | 'engine-connection' | null {
	if (!(error instanceof EngineCommandError)) return null;
	if (error.code === 'deadline') return 'engine-deadline';
	if (
		error.exitCode === undefined &&
		error.errno !== undefined &&
		DROPPED.has(error.errno)
	)
		return 'engine-connection';
	return null;
}

/** Plain words for each stage, as in "failed while <stage>". */
export const startupStageNames: Readonly<Record<BotStartupStage, string>> = {
	prepare: 'preparing the environment',
	'agent-check': 'checking the agent sign-in',
	relay: 'starting the terminay_bot relay',
	'adapter-check': 'checking the terminay_bot adapter',
	'agent-launch': 'launching the agent',
};

/**
 * Wraps a temporary engine error raised during `stage` as a startup error.
 * Anything else is returned unchanged, so existing causes keep applying.
 */
export function classifyStartup(
	error: unknown,
	stage: BotStartupStage,
): unknown {
	if (error instanceof BotStartupError) return error;
	const code = temporaryEngineCode(error);
	if (code === null) return error;
	return new BotStartupError(
		stage,
		code,
		true,
		code === 'engine-deadline'
			? `The container engine did not answer in time while ${startupStageNames[stage]}. The host may be overloaded.`
			: `The container engine connection dropped while ${startupStageNames[stage]}. The host may be overloaded.`,
	);
}

/** About 10, 30 and 60 seconds, each varied by up to a fifth. */
export function startupRetryDelay(
	retry: number,
	random: () => number = Math.random,
	base: readonly number[] = [10_000, 30_000, 60_000],
): number {
	const ms = base[Math.min(retry, base.length) - 1] ?? base.at(-1)!;
	return Math.round(ms * (0.8 + 0.4 * random()));
}

/** FIFO permits for executions in startup, across every bot on a server. */
export class StartupBudget {
	private active = 0;
	private readonly waiting: {
		id: string;
		grant: () => void;
		refuse: (error: Error) => void;
	}[] = [];
	constructor(private readonly permits = 2) {}
	get inUse(): number {
		return this.active;
	}
	/** Whether `id` is queued for a permit. */
	isWaiting(id: string): boolean {
		return this.waiting.some((w) => w.id === id);
	}
	acquire(id: string): Promise<() => void> {
		const release = () => {
			let done = false;
			return () => {
				if (done) return;
				done = true;
				this.active--;
				this.next();
			};
		};
		if (this.active < this.permits && !this.waiting.length) {
			this.active++;
			return Promise.resolve(release());
		}
		return new Promise((resolve, reject) => {
			this.waiting.push({
				id,
				grant: () => resolve(release()),
				refuse: reject,
			});
		});
	}
	/** Removes `id` from the queue, rejecting its pending acquire. */
	cancel(id: string, error: Error): void {
		const at = this.waiting.findIndex((w) => w.id === id);
		if (at < 0) return;
		const [waiter] = this.waiting.splice(at, 1);
		waiter!.refuse(error);
	}
	private next(): void {
		while (this.active < this.permits && this.waiting.length) {
			const waiter = this.waiting.shift()!;
			this.active++;
			waiter.grant();
		}
	}
}
