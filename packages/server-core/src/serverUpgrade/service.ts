import {
	parseServerUpgradeStatus,
	protocolError,
	type ServerUpgradeChannel,
	type ServerUpgradeMode,
	type ServerUpgradeProgress,
	type ServerUpgradeRefusal,
	type ServerUpgradeStatus,
} from '@terminay/protocol';

/** How long a release check's answer is taken to be current. */
export const SERVER_UPGRADE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
/** How long an upgrade this server handed over may leave it running before
 * the server stops saying one is in progress and looks again. */
export const SERVER_UPGRADE_IN_PROGRESS_DEADLINE_MS = 30 * 60 * 1000;

export type ServerUpgradeEnvironment = 'user' | 'system' | 'container';

/** How this server asks for its upgrade to be carried out. */
export type ServerUpgradeTrigger =
	| { readonly kind: 'spawn' }
	| { readonly kind: 'request-file'; readonly path: string };

/**
 * What the release's own upgrader says about this install: the one contract
 * between the server and the upgrader it ships with. The host validates it
 * before it reaches the service.
 */
export interface ServerUpgradeCheckReport {
	readonly environment: ServerUpgradeEnvironment;
	readonly installed: {
		readonly channel: ServerUpgradeChannel;
		readonly version: string;
		readonly revision: string;
	};
	readonly available: null | {
		readonly version: string;
		readonly revision?: string;
		readonly publishedAt?: string;
	};
	readonly canUpgrade: boolean;
	readonly modes: readonly ServerUpgradeMode[];
	readonly trigger: ServerUpgradeTrigger;
	readonly unavailable: null | {
		readonly reason: string;
		readonly command: string;
	};
	readonly lastResult: null | {
		readonly from: string;
		readonly to: string;
		readonly outcome: 'succeeded' | 'rolled-back';
		readonly reason?: string;
		readonly at: string;
	};
	/** Present when the release metadata could not be read: everything but
	 * `available` is still current. */
	readonly checkError?: string;
}

/** Everything the upgrader is told when an upgrade starts. Each value is the
 * server's own; none of it comes from a client beyond the choice of mode. */
export interface ServerUpgradeHandover {
	readonly environment: ServerUpgradeEnvironment;
	readonly mode: ServerUpgradeMode;
	readonly trigger: ServerUpgradeTrigger;
}

/** The release's upgrader, as the host runs it. */
export interface ServerUpgrader {
	/** Describe the install and its channel. Rejects when it could not. */
	check(): Promise<ServerUpgradeCheckReport>;
	/**
	 * Hand the upgrade to a process that outlives this server. Resolves once
	 * it is under way and rejects when it could not be started. `ended`, where
	 * the host can tell, settles if the upgrader finishes while this server is
	 * still running.
	 */
	trigger(
		handover: ServerUpgradeHandover,
	): Promise<undefined | { readonly ended?: Promise<void> }>;
}

export type ServerUpgradeDiagnostic =
	| { readonly kind: 'check-failed'; readonly message: string }
	| { readonly kind: 'check-error'; readonly message: string }
	| { readonly kind: 'trigger-failed'; readonly message: string };

export interface ServerUpgradeServiceOptions {
	/** The release this server process is, reported until a check says more. */
	readonly serverVersion: string;
	/** The release's upgrader. Without one — the embedded Local server, or a
	 * server run from a checkout — nothing is checked and nothing is offered. */
	readonly upgrader?: ServerUpgrader;
	readonly checkIntervalMs?: number;
	readonly inProgressDeadlineMs?: number;
	readonly now?: () => number;
	readonly setInterval?: (handler: () => void, milliseconds: number) => unknown;
	readonly clearInterval?: (handle: unknown) => void;
	readonly setTimeout?: (handler: () => void, milliseconds: number) => unknown;
	readonly clearTimeout?: (handle: unknown) => void;
	/** Where a failed check or handover is noted. Clients are never told. */
	readonly onDiagnostic?: (diagnostic: ServerUpgradeDiagnostic) => void;
}

/**
 * Whether this server's channel carries a newer release, and the upgrade a
 * paired device may ask for (ADR-0062).
 *
 * The status is live state: it is held here, in memory, and never reaches the
 * workspace model or disk. The server resolves nothing about releases itself;
 * it asks the upgrader its own release ships, and hands an upgrade to that
 * same upgrader. What a client may choose is the mode.
 */
export class ServerUpgradeService {
	private readonly serverVersion: string;
	private readonly upgrader: ServerUpgrader | undefined;
	private readonly checkIntervalMs: number;
	private readonly inProgressDeadlineMs: number;
	private readonly now: () => number;
	private readonly scheduleInterval: (
		handler: () => void,
		milliseconds: number,
	) => unknown;
	private readonly cancelInterval: (handle: unknown) => void;
	private readonly scheduleTimeout: (
		handler: () => void,
		milliseconds: number,
	) => unknown;
	private readonly cancelTimeout: (handle: unknown) => void;
	private readonly onDiagnostic:
		| ((diagnostic: ServerUpgradeDiagnostic) => void)
		| undefined;
	private readonly listeners = new Set<(status: ServerUpgradeStatus) => void>();
	private readonly attached = new Set<string>();
	private report: ServerUpgradeCheckReport | undefined;
	private available: { readonly version: string } | undefined;
	private outcome: ServerUpgradeProgress | undefined;
	private inProgress:
		| Extract<ServerUpgradeProgress, { state: 'in-progress' }>
		| undefined;
	private current: ServerUpgradeStatus;
	private checking: Promise<void> | undefined;
	private lastCheckAt: number | undefined;
	private checkTimer: unknown;
	private inProgressTimer: unknown;
	private attempt = 0;
	private disposed = false;

	constructor(options: ServerUpgradeServiceOptions) {
		this.serverVersion = options.serverVersion;
		this.upgrader = options.upgrader;
		this.checkIntervalMs =
			options.checkIntervalMs ?? SERVER_UPGRADE_CHECK_INTERVAL_MS;
		this.inProgressDeadlineMs =
			options.inProgressDeadlineMs ?? SERVER_UPGRADE_IN_PROGRESS_DEADLINE_MS;
		if (
			!Number.isSafeInteger(this.checkIntervalMs) ||
			this.checkIntervalMs <= 0
		)
			throw new RangeError('checkIntervalMs must be positive');
		if (
			!Number.isSafeInteger(this.inProgressDeadlineMs) ||
			this.inProgressDeadlineMs <= 0
		)
			throw new RangeError('inProgressDeadlineMs must be positive');
		this.now = options.now ?? Date.now;
		this.scheduleInterval =
			options.setInterval ??
			((handler, milliseconds) => {
				const timer = setInterval(handler, milliseconds);
				// The check never keeps a server alive that has nothing else to do.
				(timer as { unref?: () => void }).unref?.();
				return timer;
			});
		this.cancelInterval =
			options.clearInterval ??
			((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
		this.scheduleTimeout =
			options.setTimeout ??
			((handler, milliseconds) => {
				const timer = setTimeout(handler, milliseconds);
				(timer as { unref?: () => void }).unref?.();
				return timer;
			});
		this.cancelTimeout =
			options.clearTimeout ??
			((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
		this.onDiagnostic = options.onDiagnostic;
		this.current = this.derive();
	}

	/** Whether this server has an upgrader to ask. */
	get enabled(): boolean {
		return this.upgrader !== undefined;
	}

	/** What every attached client is told. */
	get status(): ServerUpgradeStatus {
		return this.current;
	}

	subscribe(listener: (status: ServerUpgradeStatus) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** The server started: look once, whoever is or is not attached. */
	start(): void {
		void this.check();
	}

	/** An authenticated connection opened. */
	clientAttached(connectionId: string): void {
		if (this.disposed || this.upgrader === undefined) return;
		if (this.attached.has(connectionId)) return;
		this.attached.add(connectionId);
		if (this.attached.size === 1 && this.checkTimer === undefined) {
			// An owner-approved poll (ADR-0028). No event tells a server behind
			// NAT that a release was published, so its channel is re-checked on
			// this interval. Approved by Mark Wylde on 2026-10-11, at one hour,
			// in change `remote-server-in-app-upgrade` (design.md decision 2).
			// It is owned by "at least one client attached": armed here on the
			// first attach and cleared in `clientDetached` on the last, so a
			// server nobody is using asks nothing.
			this.checkTimer = this.scheduleInterval(() => {
				if (this.attached.size === 0) return;
				void this.check();
			}, this.checkIntervalMs);
		}
		if (
			this.lastCheckAt === undefined ||
			this.now() - this.lastCheckAt >= this.checkIntervalMs
		)
			void this.check();
	}

	/** That connection closed. */
	clientDetached(connectionId: string): void {
		if (!this.attached.delete(connectionId)) return;
		if (this.attached.size === 0) this.disarmCheckTimer();
	}

	/**
	 * Ask the upgrader about this install. Concurrent callers share one run. A
	 * run that fails leaves what was known in place and is tried again at the
	 * next occasion; it never rejects, so it cannot disturb a connection.
	 */
	check(): Promise<void> {
		const upgrader = this.upgrader;
		if (this.disposed || upgrader === undefined) return Promise.resolve();
		// The upgrader is busy replacing this server; it is asked again when
		// that ends.
		if (this.inProgress !== undefined) return Promise.resolve();
		if (this.checking !== undefined) return this.checking;
		this.lastCheckAt = this.now();
		const run = (async () => {
			try {
				this.accept(await upgrader.check());
			} catch (error) {
				this.diagnose({ kind: 'check-failed', message: messageOf(error) });
			}
		})().finally(() => {
			if (this.checking === run) this.checking = undefined;
		});
		this.checking = run;
		return run;
	}

	/**
	 * Begin the upgrade the last check resolved, in the mode a client chose.
	 * One runs at a time, whichever device asked. The mode is the only thing
	 * taken from the request; where the upgrade goes is the upgrader's answer.
	 */
	async startUpgrade(mode: ServerUpgradeMode): Promise<ServerUpgradeStatus> {
		const upgrader = this.upgrader;
		const report = this.report;
		if (this.inProgress !== undefined)
			throw refusal('in-progress', 'a server upgrade is already in progress');
		if (
			this.disposed ||
			upgrader === undefined ||
			report === undefined ||
			this.current.available === undefined
		)
			throw refusal('none-available', 'no server upgrade is available');
		if (!this.current.canUpgrade)
			throw refusal(
				'cannot-upgrade',
				'this server cannot carry out its own upgrade',
			);
		if (!this.current.modes.includes(mode))
			throw refusal(
				'mode-not-offered',
				'this server does not offer that upgrade mode',
			);
		const attempt = ++this.attempt;
		this.inProgress = Object.freeze({
			state: 'in-progress',
			mode,
			startedAt: this.now(),
		});
		this.publish();
		let handed: undefined | { readonly ended?: Promise<void> };
		try {
			handed = await upgrader.trigger({
				environment: report.environment,
				mode,
				trigger: report.trigger,
			});
		} catch (error) {
			this.diagnose({ kind: 'trigger-failed', message: messageOf(error) });
			if (this.attempt === attempt) {
				this.inProgress = undefined;
				this.publish();
			}
			throw protocolError(
				'unavailable',
				'the server could not start its upgrade',
				{
					details: { reason: 'trigger-failed' satisfies ServerUpgradeRefusal },
					retryable: true,
				},
			);
		}
		if (this.disposed || this.attempt !== attempt) return this.current;
		// The upgrader normally ends this server. If it finishes, or the
		// deadline passes, while the server is still running, the upgrade did
		// not happen: stop saying it is in progress and look again. A one-shot
		// deadline, not a poll (ADR-0028 decision 3).
		const settle = (): void => this.endAttempt(attempt);
		this.inProgressTimer = this.scheduleTimeout(
			settle,
			this.inProgressDeadlineMs,
		);
		handed?.ended?.then(settle, settle);
		return this.current;
	}

	dispose(): void {
		this.disposed = true;
		this.disarmCheckTimer();
		this.disarmInProgressTimer();
		this.attached.clear();
		this.listeners.clear();
	}

	private endAttempt(attempt: number): void {
		if (this.disposed || this.attempt !== attempt) return;
		if (this.inProgress === undefined) return;
		this.disarmInProgressTimer();
		this.inProgress = undefined;
		this.publish();
		void this.check();
	}

	private accept(report: ServerUpgradeCheckReport): void {
		if (this.disposed) return;
		if (report.checkError !== undefined)
			this.diagnose({ kind: 'check-error', message: report.checkError });
		const previous = {
			report: this.report,
			available: this.available,
			outcome: this.outcome,
		};
		this.report = report;
		// Without release metadata the upgrader cannot say what is available,
		// so what was last known stands.
		if (report.checkError === undefined)
			this.available =
				report.available === null
					? undefined
					: Object.freeze({ version: report.available.version });
		try {
			this.outcome = outcomeOf(report.lastResult);
			this.publish();
		} catch (error) {
			// A report the status cannot carry is a failed check.
			this.report = previous.report;
			this.available = previous.available;
			this.outcome = previous.outcome;
			throw error;
		}
	}

	/** Bring the published status in line and tell clients if it changed. */
	private publish(): void {
		const next = this.derive();
		if (JSON.stringify(next) === JSON.stringify(this.current)) return;
		this.current = next;
		for (const listener of this.listeners) {
			try {
				listener(next);
			} catch {
				/* a failing observer changes nothing about the upgrade */
			}
		}
	}

	private derive(): ServerUpgradeStatus {
		const report = this.report;
		const canUpgrade = report?.canUpgrade === true;
		// A request file starts one fixed command; it cannot carry a mode.
		const modes = !canUpgrade
			? []
			: report.modes.filter(
					(mode) => mode !== 'recreate' || report.trigger.kind === 'spawn',
				);
		return parseServerUpgradeStatus({
			version: report?.installed.version ?? this.serverVersion,
			...(report === undefined ? {} : { channel: report.installed.channel }),
			...(this.available === undefined ? {} : { available: this.available }),
			canUpgrade,
			modes,
			...(modes.includes('recreate') ? { recreateEndsTerminals: true } : {}),
			...(report === undefined || report.unavailable === null
				? {}
				: {
						unavailable: {
							reason: report.unavailable.reason,
							command: report.unavailable.command,
						},
					}),
			upgrade: this.inProgress ?? this.outcome ?? { state: 'none' },
		});
	}

	private disarmCheckTimer(): void {
		if (this.checkTimer === undefined) return;
		this.cancelInterval(this.checkTimer);
		this.checkTimer = undefined;
	}

	private disarmInProgressTimer(): void {
		if (this.inProgressTimer === undefined) return;
		this.cancelTimeout(this.inProgressTimer);
		this.inProgressTimer = undefined;
	}

	private diagnose(diagnostic: ServerUpgradeDiagnostic): void {
		try {
			this.onDiagnostic?.(diagnostic);
		} catch {
			/* a diagnostic sink cannot affect the check */
		}
	}
}

/** The outcome record the upgrader left, as clients are told it. */
function outcomeOf(
	result: ServerUpgradeCheckReport['lastResult'],
): ServerUpgradeProgress | undefined {
	if (result === null) return undefined;
	const at = Date.parse(result.at);
	if (!Number.isSafeInteger(at) || at < 0)
		throw new TypeError('upgrade outcome time is invalid');
	return result.outcome === 'succeeded'
		? Object.freeze({
				state: 'succeeded',
				from: result.from,
				to: result.to,
				at,
			})
		: Object.freeze({
				state: 'failed',
				from: result.from,
				to: result.to,
				...(result.reason === undefined ? {} : { reason: result.reason }),
				restored: true,
				at,
			});
}

function refusal(reason: ServerUpgradeRefusal, message: string) {
	return protocolError('conflict', message, {
		details: { reason },
		retryable: false,
	});
}

function messageOf(error: unknown): string {
	return (error instanceof Error ? error.message : String(error)).slice(
		0,
		1024,
	);
}
