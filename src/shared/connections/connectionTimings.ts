import {
	type ConnectionMetricHost,
	type ConnectionMetricSample,
	type ConnectionMetricTrigger,
	classifyConnectionFailure,
	type HostConnectTimings,
	normalizeConnectionMetricSample,
} from '@terminay/protocol';

/** A loss this soon after the document was shown was found by returning. */
export const RESUME_DETECTION_WINDOW_MS = 10_000;

type Loss = Readonly<{
	trigger: ConnectionMetricTrigger;
	at: number;
	hiddenMs?: number;
	detectMs?: number;
}>;

type Attempt = {
	startedAt: number;
	transportAt?: number;
	helloAt?: number;
	host?: HostConnectTimings;
};

/**
 * Times one connection's connects and recoveries for `connection.metrics`.
 *
 * It holds marks only, never identity: the sample it builds carries a trigger,
 * the host kind, durations and an attempt count. The connection entry tells it
 * what happened; it decides nothing about the connection itself.
 */
export class ConnectionTimingTracker {
	private readonly now: () => number;
	private readonly host: ConnectionMetricHost;
	private hiddenAt: number | undefined;
	private shownAt: number | undefined;
	private lastHiddenMs: number | undefined;
	private everReady = false;
	private loss: Loss | undefined;
	private firstAttemptAt: number | undefined;
	private attempts = 0;
	private failure: unknown;
	private attempt: Attempt | undefined;

	constructor(host: ConnectionMetricHost, now: () => number = Date.now) {
		this.host = host;
		this.now = now;
	}

	hidden(): void {
		this.hiddenAt ??= this.now();
	}

	shown(): void {
		const at = this.now();
		this.lastHiddenMs =
			this.hiddenAt === undefined ? undefined : at - this.hiddenAt;
		this.hiddenAt = undefined;
		this.shownAt = at;
	}

	/** The first signal of a loss wins; later ones describe the same loss. */
	lost(trigger: ConnectionMetricTrigger): void {
		if (this.loss !== undefined) return;
		const at = this.now();
		const sinceShown =
			this.shownAt === undefined ? undefined : at - this.shownAt;
		const foundOnReturn =
			sinceShown !== undefined && sinceShown <= RESUME_DETECTION_WINDOW_MS;
		this.loss = Object.freeze({
			trigger,
			at,
			...(foundOnReturn && this.lastHiddenMs !== undefined
				? { hiddenMs: this.lastHiddenMs }
				: {}),
			...(foundOnReturn ? { detectMs: sinceShown } : {}),
		});
	}

	attemptStarted(): void {
		const at = this.now();
		this.firstAttemptAt ??= at;
		this.attempts += 1;
		this.attempt = { startedAt: at };
	}

	attemptFailed(cause: unknown): void {
		this.failure = cause;
		this.attempt = undefined;
	}

	transportOpened(host?: HostConnectTimings): void {
		if (this.attempt === undefined) return;
		this.attempt.transportAt = this.now();
		if (host !== undefined) this.attempt.host = host;
	}

	helloReceived(): void {
		if (this.attempt === undefined) return;
		this.attempt.helloAt = this.now();
	}

	/** The connection is ready: the sample for this connect, and a reset. */
	ready(): ConnectionMetricSample | undefined {
		const attempt = this.attempt;
		const at = this.now();
		const recovering = this.everReady;
		const loss = this.loss;
		const startedAt = loss?.at ?? this.firstAttemptAt ?? attempt?.startedAt;
		const sample =
			attempt === undefined
				? undefined
				: normalizeConnectionMetricSample({
						kind: recovering ? 'recover' : 'connect',
						trigger: loss?.trigger ?? (recovering ? 'transport-closed' : 'initial'),
						host: this.host,
						attempts: Math.max(1, this.attempts),
						...(this.attempts > 1 && this.failure !== undefined
							? { failure: classifyConnectionFailure(this.failure) }
							: {}),
						...(loss?.hiddenMs === undefined ? {} : { hiddenMs: loss.hiddenMs }),
						...(loss?.detectMs === undefined ? {} : { detectMs: loss.detectMs }),
						...(attempt.host ?? {}),
						...(attempt.transportAt === undefined
							? {}
							: { transportMs: attempt.transportAt - attempt.startedAt }),
						...(attempt.transportAt === undefined || attempt.helloAt === undefined
							? {}
							: { helloMs: attempt.helloAt - attempt.transportAt }),
						...(attempt.helloAt === undefined
							? {}
							: { syncMs: at - attempt.helloAt }),
						...(startedAt === undefined ? {} : { totalMs: at - startedAt }),
					});
		this.everReady = true;
		this.loss = undefined;
		this.firstAttemptAt = undefined;
		this.attempts = 0;
		this.failure = undefined;
		this.attempt = undefined;
		return sample;
	}

	/** A resume probe was answered: the connection survived being hidden. */
	resumeAnswered(roundTripMs: number): ConnectionMetricSample | undefined {
		return normalizeConnectionMetricSample({
			kind: 'resume-alive',
			trigger: 'resume-probe',
			host: this.host,
			probeRttMs: roundTripMs,
			...(this.lastHiddenMs === undefined ? {} : { hiddenMs: this.lastHiddenMs }),
		});
	}
}
