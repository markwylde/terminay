import { randomUUID } from 'node:crypto';
import {
	parseServerUpgradeAttemptState,
	parseServerUpgradeStatus,
	protocolError,
	SERVER_UPGRADE_MAX_TEXT_CHARS,
	SERVER_UPGRADE_MAX_VERSION_CHARS,
	type ServerUpgradeAttemptKind,
	type ServerUpgradeAttemptStage,
	type ServerUpgradeAttemptState,
	type ServerUpgradeChannel,
	type ServerUpgradeEnding,
	type ServerUpgradeLatestOrder,
	type ServerUpgradeMode,
	type ServerUpgradeProgress,
	type ServerUpgradeRefusal,
	type ServerUpgradeStatus,
} from '@terminay/protocol';

/** What a server run without `TERMINAY_SERVER_VERSION` calls itself. */
const UNKNOWN_SERVER_VERSION = '0.0.0';

/** How long a release check's answer is taken to be current. */
export const SERVER_UPGRADE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** A check a client asks for within this long of a good one answers from it. */
export const SERVER_UPGRADE_CHECK_NOW_FLOOR_MS = 10_000;

/**
 * When the server looks again soon after it starts, measured from the start.
 * An upgrader that restarted this server records the new release only once
 * this server reports ready, so the check at start can read the release it
 * replaced. The record's watch picks that up where it can be armed; these few
 * checks cover a server whose upgrader keeps no record. Like the hourly check
 * they ask only while a client is attached, and they are bounded to one
 * start, not a poll (ADR-0028).
 */
export const SERVER_UPGRADE_SETTLE_CHECKS_MS: readonly number[] = Object.freeze(
	[10_000, 30_000, 90_000],
);
/** How long an attempt may stay pending before it ends as unknown: its
 * absolute expiry, measured from its start (ADR-0125). */
export const SERVER_UPGRADE_IN_PROGRESS_DEADLINE_MS = 30 * 60 * 1000;

export type ServerUpgradeEnvironment = 'user' | 'system' | 'container';

/** How this server asks for its upgrade to be carried out. */
export type ServerUpgradeTrigger =
	| { readonly kind: 'spawn' }
	| {
			readonly kind: 'request-file';
			readonly path: string;
			/** The install-latest helper's request file (ADR-0117), when installed. */
			readonly latestPath?: string;
	  };

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
	/** The newest release on the channel, whichever way it orders. Absent from
	 * an upgrader that predates install-latest. */
	readonly latest?: null | {
		readonly version: string;
		readonly revision?: string;
		readonly publishedAt?: string;
		readonly order: ServerUpgradeLatestOrder;
	};
	/** Why `latest` cannot be installed from here; null when it can. */
	readonly installLatestUnavailable?: null | {
		readonly reason: string;
		readonly command: string;
	};
	/** Where the upgrader writes its run records (ADR-0125). Absent from an
	 * upgrader that predates them; null where the install has none. */
	readonly recordPath?: string | null;
	readonly lastResult: null | ServerUpgradeRunRecord;
	/** Present when the release metadata could not be read: everything but
	 * `available` is still current. */
	readonly checkError?: string;
}

/** A release as an upgrader's record names it. */
export interface ServerUpgradeRelease {
	readonly channel: string;
	readonly version: string;
	readonly revision: string;
}

/**
 * One record the upgrader wrote: a run's start, or its one ending
 * (ADR-0125). A record from an upgrader that predates runs has no `run`.
 */
export interface ServerUpgradeRunRecord {
	readonly run?: string;
	readonly runStartedAt?: string;
	readonly from: string;
	readonly to: string;
	readonly fromRelease?: ServerUpgradeRelease;
	readonly toRelease?: ServerUpgradeRelease;
	readonly outcome: 'started' | 'succeeded' | 'rolled-back' | 'unchanged' | 'failed';
	readonly reason?: string;
	readonly at: string;
}

/** Which watched file changed. */
export type ServerUpgradeRecordChange = 'record' | 'install';

/** A watch on the upgrader's record, closed when no longer needed. */
export interface ServerUpgradeRecordWatch {
	close(): void;
}

/** Everything the upgrader is told when an upgrade starts. Each value is the
 * server's own; none of it comes from a client beyond the choice of mode. */
export interface ServerUpgradeHandover {
	readonly environment: ServerUpgradeEnvironment;
	readonly mode: ServerUpgradeMode;
	readonly trigger: ServerUpgradeTrigger;
	/** Install the channel's latest release even when it is older (ADR-0117). */
	readonly allowOlder?: true;
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
	/** Read the record at the path the check reported. Undefined when there is
	 * none or it cannot be read. */
	readRecord?(path: string): Promise<ServerUpgradeRunRecord | undefined>;
	/**
	 * Watch the record, and the install record beside it, for replacement.
	 * Throws when the watch cannot be armed (ADR-0028: a watch, never a poll).
	 */
	watchRecord?(
		path: string,
		listener: (change: ServerUpgradeRecordChange) => void,
	): ServerUpgradeRecordWatch;
}

export type ServerUpgradeDiagnostic =
	| { readonly kind: 'check-failed'; readonly message: string }
	| { readonly kind: 'check-error'; readonly message: string }
	| { readonly kind: 'trigger-failed'; readonly message: string }
	| { readonly kind: 'attempt-store'; readonly message: string }
	| { readonly kind: 'record-watch'; readonly message: string };

/**
 * An upgrade attempt as the server keeps it in its data root (ADR-0125). It
 * is the server's own state: nothing in it reaches the upgrader.
 */
export interface PersistedServerUpgradeAttempt {
	readonly schemaVersion: 1;
	readonly id: string;
	readonly requestId?: string;
	readonly mode: ServerUpgradeMode;
	readonly kind: ServerUpgradeAttemptKind;
	readonly startedAt: number;
	readonly expiresAt: number;
	/** The release this server ran when the attempt began. */
	readonly from: {
		readonly channel: string;
		readonly version: string;
		readonly revision?: string;
	};
	/** The upgrader run bound to this attempt, once one started after it. */
	readonly run?: { readonly id: string; readonly startedAt: number };
	readonly ending?: ServerUpgradeEnding;
}

/** Where the server keeps its last attempt. */
export interface ServerUpgradeAttemptStore {
	/** What was kept, unvalidated; undefined when nothing was. */
	load(): Promise<unknown>;
	/** Replace what is kept, atomically. Rejects when it could not. */
	save(attempt: PersistedServerUpgradeAttempt): Promise<void>;
	/** Keep nothing, or the attempt before, again. */
	restore(attempt: PersistedServerUpgradeAttempt | undefined): Promise<void>;
}

/** How long after a start the upgrader must have recorded that it started. */
export const SERVER_UPGRADE_BIND_DEADLINE_MS = 2 * 60 * 1000;

export interface ServerUpgradeServiceOptions {
	/** The release this server process is, reported until a check says more. */
	readonly serverVersion: string;
	/** The commit this server process was built from, when its launcher says.
	 * It, not the version string, names a build (ADR-0125). */
	readonly serverRevision?: string;
	/** The release's upgrader. Without one — the embedded Local server, or a
	 * server run from a checkout — nothing is checked and nothing is offered. */
	readonly upgrader?: ServerUpgrader;
	/** Where the last attempt is kept. Without one it is kept in memory. */
	readonly attemptStore?: ServerUpgradeAttemptStore;
	readonly checkIntervalMs?: number;
	/** How long an attempt may stay pending before it ends as unknown. */
	readonly inProgressDeadlineMs?: number;
	/** How long an attempt may wait for its upgrader run to start. */
	readonly bindDeadlineMs?: number;
	readonly now?: () => number;
	readonly randomId?: () => string;
	readonly setInterval?: (handler: () => void, milliseconds: number) => unknown;
	readonly clearInterval?: (handle: unknown) => void;
	readonly setTimeout?: (handler: () => void, milliseconds: number) => unknown;
	readonly clearTimeout?: (handle: unknown) => void;
	/** Where a failed check or handover is noted. Clients are never told. */
	readonly onDiagnostic?: (diagnostic: ServerUpgradeDiagnostic) => void;
}

type Attempt = PersistedServerUpgradeAttempt;

/**
 * Whether this server's channel carries a newer release, and the upgrade a
 * paired device may ask for (ADR-0062).
 *
 * The status is live state, held here in memory. The server resolves nothing
 * about releases itself; it asks the upgrader its own release ships, and
 * hands an upgrade to that same upgrader. What a client may choose is the
 * mode.
 *
 * Each accepted start is an attempt the server owns (ADR-0125): it is kept in
 * the data root before the handover, bound to the first upgrader run that
 * starts after it, and ended only by that run's own record or by its
 * absolute deadlines. Nothing is inferred from versions or times.
 */
export class ServerUpgradeService {
	private readonly serverVersion: string;
	private readonly serverRevision: string | undefined;
	private readonly upgrader: ServerUpgrader | undefined;
	private readonly store: ServerUpgradeAttemptStore | undefined;
	private readonly checkIntervalMs: number;
	private readonly lifetimeMs: number;
	private readonly bindDeadlineMs: number;
	private readonly now: () => number;
	private readonly randomId: () => string;
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
	private readonly attemptListeners = new Set<
		(state: ServerUpgradeAttemptState) => void
	>();
	private readonly attached = new Set<string>();
	/** When this process began, to tell a run that began before it. */
	private readonly processStartedAt: number;
	private report: ServerUpgradeCheckReport | undefined;
	private available: { readonly version: string } | undefined;
	private latest: ServerUpgradeCheckReport['latest'];
	private outcome: ServerUpgradeProgress | undefined;
	private attempt: Attempt | undefined;
	private current: ServerUpgradeStatus;
	private currentAttempt: ServerUpgradeAttemptState = Object.freeze({
		attempt: null,
	});
	private checking: Promise<void> | undefined;
	private lastCheckAt: number | undefined;
	/** Why the last check could not read the channel, while it could not. */
	private lastCheckFailure: string | undefined;
	private checkTimer: unknown;
	private bindTimer: unknown;
	private expiryTimer: unknown;
	private settleTimers: unknown[] = [];
	private watch: ServerUpgradeRecordWatch | undefined;
	private watchedPath: string | undefined;
	private starting = false;
	private recovered: Promise<void> = Promise.resolve();
	private disposed = false;

	constructor(options: ServerUpgradeServiceOptions) {
		this.serverVersion = options.serverVersion;
		const revision = options.serverRevision?.trim();
		this.serverRevision =
			revision === undefined || revision.length === 0 ? undefined : revision;
		this.upgrader = options.upgrader;
		this.store = options.attemptStore;
		this.checkIntervalMs =
			options.checkIntervalMs ?? SERVER_UPGRADE_CHECK_INTERVAL_MS;
		this.lifetimeMs =
			options.inProgressDeadlineMs ?? SERVER_UPGRADE_IN_PROGRESS_DEADLINE_MS;
		this.bindDeadlineMs =
			options.bindDeadlineMs ?? SERVER_UPGRADE_BIND_DEADLINE_MS;
		if (
			!Number.isSafeInteger(this.checkIntervalMs) ||
			this.checkIntervalMs <= 0
		)
			throw new RangeError('checkIntervalMs must be positive');
		if (!Number.isSafeInteger(this.lifetimeMs) || this.lifetimeMs <= 0)
			throw new RangeError('inProgressDeadlineMs must be positive');
		if (!Number.isSafeInteger(this.bindDeadlineMs) || this.bindDeadlineMs <= 0)
			throw new RangeError('bindDeadlineMs must be positive');
		this.now = options.now ?? Date.now;
		this.randomId = options.randomId ?? randomUUID;
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
		this.processStartedAt = this.now();
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

	/** The last attempt, pending or ended (ADR-0125). */
	get attemptState(): ServerUpgradeAttemptState {
		return this.currentAttempt;
	}

	subscribe(listener: (status: ServerUpgradeStatus) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	subscribeAttempt(
		listener: (state: ServerUpgradeAttemptState) => void,
	): () => void {
		this.attemptListeners.add(listener);
		return () => this.attemptListeners.delete(listener);
	}

	/** The server started: take up its last attempt, and look once. */
	start(): void {
		this.recovered = this.recover();
		void this.recovered.then(() => this.check());
		if (this.upgrader === undefined) return;
		for (const delay of SERVER_UPGRADE_SETTLE_CHECKS_MS) {
			const timer = this.scheduleTimeout(() => {
				this.settleTimers = this.settleTimers.filter((t) => t !== timer);
				// Like the hourly check, asked only for someone attached.
				if (this.attached.size === 0) return;
				void this.check();
			}, delay);
			this.settleTimers.push(timer);
		}
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
		// A stale install record is not news to wait an hour on.
		if (
			this.lastCheckAt === undefined ||
			this.recordIsStale() ||
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
		// the attempt ends. A server that took the attempt up asks once, to
		// learn where the upgrader's record is.
		if (this.pending() !== undefined && this.report !== undefined)
			return Promise.resolve();
		if (this.checking !== undefined) return this.checking;
		this.lastCheckAt = this.now();
		const run = (async () => {
			try {
				const report = await upgrader.check();
				this.accept(report);
				this.lastCheckFailure = report.checkError;
			} catch (error) {
				this.lastCheckFailure = messageOf(error);
				this.diagnose({ kind: 'check-failed', message: messageOf(error) });
			}
		})().finally(() => {
			if (this.checking === run) this.checking = undefined;
		});
		this.checking = run;
		return run;
	}

	/**
	 * A client asked to look now. Shares a check already running, answers from
	 * one that succeeded moments ago, and otherwise reads the channel before it
	 * replies, so the reply is the status that check produced. A check that
	 * could not read the channel is refused, not answered with stale news.
	 */
	async checkNow(): Promise<ServerUpgradeStatus> {
		if (this.disposed || this.upgrader === undefined)
			throw refusal(
				'cannot-check',
				'this server has no upgrader to check its release channel',
			);
		// Replacing this server is already under way; the status says so.
		if (this.pending() !== undefined) return this.current;
		const fresh =
			this.checking === undefined &&
			this.lastCheckAt !== undefined &&
			this.lastCheckFailure === undefined &&
			this.now() - this.lastCheckAt < SERVER_UPGRADE_CHECK_NOW_FLOOR_MS;
		if (!fresh) await this.check();
		if (this.lastCheckFailure !== undefined)
			throw protocolError(
				'unavailable',
				'the server could not read its release channel',
				{
					details: { reason: 'check-failed' satisfies ServerUpgradeRefusal },
					retryable: true,
				},
			);
		return this.current;
	}

	/**
	 * Begin the upgrade the last check resolved, in the mode a client chose.
	 * One runs at a time, whichever device asked. The mode is the only thing
	 * taken from the request; where the upgrade goes is the upgrader's answer.
	 */
	async startUpgrade(
		mode: ServerUpgradeMode,
		options: { readonly allowOlder?: true; readonly requestId?: string } = {},
	): Promise<ServerUpgradeStatus> {
		const upgrader = this.upgrader;
		const report = this.report;
		const allowOlder = options.allowOlder === true;
		if (this.starting || this.pending() !== undefined)
			throw refusal('in-progress', 'a server upgrade is already in progress');
		if (allowOlder) {
			// Install latest (ADR-0117): the target is still the upgrader's own
			// answer for this channel. Only the direction is the client's consent.
			const latest = this.current.latest;
			if (
				this.disposed ||
				upgrader === undefined ||
				report === undefined ||
				latest === undefined
			)
				throw refusal(
					'none-available',
					'no latest release is known for this channel',
				);
			if (latest.order === 'same')
				throw refusal(
					'already-latest',
					'this server already runs the latest release on its channel',
				);
			if (!latest.canInstall)
				throw refusal(
					'cannot-install-latest',
					'this server cannot install the latest release on its channel itself',
				);
			if (mode !== 'in-place')
				throw refusal(
					'mode-not-offered',
					'the latest release is installed in place only',
				);
		} else {
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
		}
		// One start at a time: create, persist, and hand over under this flag.
		this.starting = true;
		try {
			await this.recovered;
			if (this.disposed || this.pending() !== undefined)
				throw refusal('in-progress', 'a server upgrade is already in progress');
			// A run already under way on the host — perhaps an operator's — holds
			// the install; a second would be refused by its lock.
			const record = await this.readRecord();
			if (
				record?.outcome === 'started' &&
				this.now() - timeOf(record.runStartedAt ?? record.at) < this.lifetimeMs
			)
				throw refusal(
					'in-progress',
					'an upgrade is already running on the host',
				);
			const startedAt = this.now();
			const attempt: Attempt = Object.freeze({
				schemaVersion: 1,
				id: this.randomId(),
				...(options.requestId === undefined
					? {}
					: { requestId: options.requestId }),
				mode,
				kind: allowOlder ? 'install-latest' : 'upgrade',
				startedAt,
				expiresAt: startedAt + this.lifetimeMs,
				from: {
					channel: report.installed.channel,
					version: this.runningVersion(),
					...(this.serverRevision === undefined
						? {}
						: { revision: this.serverRevision }),
				},
			});
			// Kept before the handover: a server the upgrade restarts takes it up.
			try {
				await this.store?.save(attempt);
			} catch (error) {
				this.diagnose({ kind: 'attempt-store', message: messageOf(error) });
				throw protocolError(
					'unavailable',
					'the server could not record its upgrade attempt',
					{
						details: {
							reason: 'trigger-failed' satisfies ServerUpgradeRefusal,
						},
						retryable: true,
					},
				);
			}
			const before = this.attempt;
			this.attempt = attempt;
			this.armDeadlines();
			this.syncWatch();
			this.publish();
			let handed: undefined | { readonly ended?: Promise<void> };
			try {
				handed = await upgrader.trigger({
					environment: report.environment,
					mode,
					trigger: report.trigger,
					...(allowOlder ? { allowOlder: true as const } : {}),
				});
			} catch (error) {
				this.diagnose({ kind: 'trigger-failed', message: messageOf(error) });
				// Nothing was handed over, so there was no attempt: the device
				// that asked is told by the reply, and may ask again.
				if (this.attempt?.id === attempt.id) {
					this.attempt = before;
					this.disarmDeadlines();
					this.syncWatch();
					this.publish();
					await this.store?.restore(before).catch((problem: unknown) =>
						this.diagnose({
							kind: 'attempt-store',
							message: messageOf(problem),
						}),
					);
				}
				throw protocolError(
					'unavailable',
					'the server could not start its upgrade',
					{
						details: {
							reason: 'trigger-failed' satisfies ServerUpgradeRefusal,
						},
						retryable: true,
					},
				);
			}
			// A spawned upgrader that exits while this server still runs has
			// either recorded how it ended or failed to.
			void handed?.ended?.then(
				() => this.upgraderExited(attempt.id),
				() => this.upgraderExited(attempt.id),
			);
			return this.current;
		} finally {
			this.starting = false;
		}
	}

	dispose(): void {
		this.disposed = true;
		this.disarmCheckTimer();
		this.disarmDeadlines();
		this.disarmSettleTimers();
		this.closeWatch();
		this.attached.clear();
		this.listeners.clear();
		this.attemptListeners.clear();
	}

	/** Take up the attempt kept by the server that ran before this one. */
	private async recover(): Promise<void> {
		if (this.store === undefined || this.attempt !== undefined) return;
		let kept: unknown;
		try {
			kept = await this.store.load();
		} catch (error) {
			this.diagnose({ kind: 'attempt-store', message: messageOf(error) });
			return;
		}
		if (kept === undefined || this.disposed || this.attempt !== undefined)
			return;
		const attempt = parsePersistedAttempt(kept);
		if (attempt === undefined) {
			this.diagnose({
				kind: 'attempt-store',
				message: 'the kept upgrade attempt is malformed and was ignored',
			});
			return;
		}
		this.attempt = attempt;
		if (attempt.ending === undefined && this.now() >= attempt.expiresAt) {
			// Its time ran out while no server was watching it.
			await this.end(attempt.id, this.expiredEnding(attempt));
			return;
		}
		this.armDeadlines();
		this.publish();
	}

	/** The pending attempt, if there is one. */
	private pending(): Attempt | undefined {
		const attempt = this.attempt;
		return attempt !== undefined && attempt.ending === undefined
			? attempt
			: undefined;
	}

	/** What the upgrader's record says now. */
	private async readRecord(): Promise<ServerUpgradeRunRecord | undefined> {
		const path = this.report?.recordPath;
		const read = this.upgrader?.readRecord;
		if (path == null || read === undefined) return undefined;
		try {
			return await read.call(this.upgrader, path);
		} catch {
			return undefined;
		}
	}

	/** Read the record and act on it. */
	private async readAndApply(): Promise<void> {
		const record = await this.readRecord();
		if (record !== undefined) await this.applyRecord(record);
	}

	/**
	 * A record the upgrader wrote. The first run that started after the
	 * pending attempt is bound to it, and only that run's ending ends it.
	 * Anything else — another run, an older record — changes nothing.
	 */
	private async applyRecord(record: ServerUpgradeRunRecord): Promise<void> {
		const attempt = this.pending();
		if (attempt === undefined || record.run === undefined) return;
		let bound = attempt;
		if (attempt.run === undefined) {
			const runStartedAt = timeOf(
				record.runStartedAt ??
					(record.outcome === 'started' ? record.at : undefined),
			);
			if (!Number.isFinite(runStartedAt) || runStartedAt < attempt.startedAt)
				return;
			bound = Object.freeze({
				...attempt,
				run: Object.freeze({ id: record.run, startedAt: runStartedAt }),
			});
			this.attempt = bound;
			this.disarmBindTimer();
		}
		if (bound.run?.id !== record.run) return;
		if (record.outcome === 'started') {
			if (bound !== attempt) {
				await this.save(bound);
				this.publish();
			}
			return;
		}
		await this.end(bound.id, endingOf(record, this.now()));
	}

	/** A spawned upgrader exited while this server still runs. */
	private async upgraderExited(id: string): Promise<void> {
		await this.readAndApply();
		if (this.pending()?.id !== id) return;
		const attempt = this.pending() as Attempt;
		await this.end(id, {
			kind: 'failed',
			from: attempt.from.version,
			to: attempt.from.version,
			reason: 'the upgrader exited without recording how it ended',
			at: this.now(),
		});
	}

	/** End the pending attempt, if it is still the one named. */
	private async end(id: string, ending: ServerUpgradeEnding): Promise<void> {
		const attempt = this.attempt;
		if (attempt === undefined || attempt.id !== id || attempt.ending !== undefined)
			return;
		const ended: Attempt = Object.freeze({
			...attempt,
			ending: Object.freeze(ending),
		});
		this.attempt = ended;
		this.disarmDeadlines();
		this.publish();
		this.syncWatch();
		await this.save(ended);
		// What the channel offers may have changed with it.
		void this.check();
	}

	private async save(attempt: Attempt): Promise<void> {
		try {
			await this.store?.save(attempt);
		} catch (error) {
			this.diagnose({ kind: 'attempt-store', message: messageOf(error) });
		}
	}

	/**
	 * The two absolute deadlines of the pending attempt, as one-shot timers
	 * for the time that remains (ADR-0028 decision 3). A restart re-arms them
	 * from the kept times and never extends them.
	 */
	private armDeadlines(): void {
		this.disarmDeadlines();
		const attempt = this.pending();
		if (attempt === undefined) return;
		const { id } = attempt;
		// Only an upgrader that keeps run records can be heard to start.
		if (attempt.run === undefined && this.canHearRuns())
			this.bindTimer = this.scheduleTimeout(
				() => {
					this.bindTimer = undefined;
					void this.bindDeadlinePassed(id);
				},
				Math.max(0, attempt.startedAt + this.bindDeadlineMs - this.now()),
			);
		this.expiryTimer = this.scheduleTimeout(
			() => {
				this.expiryTimer = undefined;
				void this.expired(id);
			},
			Math.max(0, attempt.expiresAt - this.now()),
		);
	}

	private async bindDeadlinePassed(id: string): Promise<void> {
		await this.readAndApply();
		const attempt = this.pending();
		if (attempt?.id !== id || attempt.run !== undefined) return;
		await this.end(id, {
			kind: 'failed',
			from: attempt.from.version,
			to: attempt.from.version,
			reason: `the upgrader did not start. Run ${this.upgradeCommand()} on the server's host to upgrade it.`,
			at: this.now(),
		});
	}

	private async expired(id: string): Promise<void> {
		await this.readAndApply();
		const attempt = this.pending();
		if (attempt?.id !== id) return;
		await this.end(id, this.expiredEnding(attempt));
	}

	/** An attempt whose time ran out without its run saying how it ended:
	 * unknown, never success. */
	private expiredEnding(attempt: Attempt): ServerUpgradeEnding {
		const revision =
			this.serverRevision === undefined
				? ''
				: ` (${this.serverRevision.slice(0, 7)})`;
		return {
			kind: 'failed',
			from: attempt.from.version,
			to: this.runningVersion(),
			reason: `the upgrader did not report how it ended; the server now runs ${this.runningVersion()}${revision}`.slice(
				0,
				SERVER_UPGRADE_MAX_TEXT_CHARS,
			),
			at: this.now(),
		};
	}

	private upgradeCommand(): string {
		switch (this.report?.environment) {
			case 'system':
				return '`sudo terminay daemon upgrade --system`';
			case 'container':
				return '`terminay daemon upgrade` in the container';
			default:
				return '`terminay daemon upgrade --user`';
		}
	}

	/** Whether this server can read its upgrader's run records. */
	private canHearRuns(): boolean {
		return (
			typeof this.report?.recordPath === 'string' &&
			this.upgrader?.readRecord !== undefined
		);
	}

	/** Whether the install record names another build than this process. */
	private recordIsStale(): boolean {
		const report = this.report;
		return (
			report !== undefined &&
			this.serverRevision !== undefined &&
			report.installed.channel !== 'source' &&
			report.installed.revision.length > 0 &&
			report.installed.revision !== this.serverRevision
		);
	}

	/**
	 * The record is watched while an attempt is pending or the install record
	 * is stale, and not otherwise. Arming reads once, so nothing written
	 * before the watch began is missed.
	 */
	private syncWatch(): void {
		const path = this.report?.recordPath ?? undefined;
		const wanted =
			!this.disposed &&
			path !== undefined &&
			this.upgrader?.watchRecord !== undefined &&
			(this.pending() !== undefined || this.recordIsStale());
		if (!wanted || this.watchedPath !== path) this.closeWatch();
		if (!wanted || this.watch !== undefined) return;
		try {
			this.watch = (this.upgrader as ServerUpgrader).watchRecord?.(
				path as string,
				(change) => {
					if (change === 'install') void this.check();
					else void this.readAndApply();
				},
			);
			this.watchedPath = path;
		} catch (error) {
			// Without the watch the attempt still ends at its deadlines and on a
			// spawned upgrader's exit.
			this.diagnose({ kind: 'record-watch', message: messageOf(error) });
		}
		void this.readAndApply();
	}

	private closeWatch(): void {
		const watch = this.watch;
		this.watch = undefined;
		this.watchedPath = undefined;
		try {
			watch?.close();
		} catch {
			/* a watch that cannot close has nothing more to say */
		}
	}

	private runningVersion(): string {
		return this.serverVersion === UNKNOWN_SERVER_VERSION
			? (this.report?.installed.version ?? this.serverVersion)
			: this.serverVersion;
	}

	private accept(report: ServerUpgradeCheckReport): void {
		if (this.disposed) return;
		if (report.checkError !== undefined)
			this.diagnose({ kind: 'check-error', message: report.checkError });
		const previous = {
			report: this.report,
			available: this.available,
			latest: this.latest,
			outcome: this.outcome,
		};
		this.report = report;
		// Without release metadata the upgrader cannot say what is available,
		// so what was last known stands.
		if (report.checkError === undefined) {
			this.available =
				report.available === null || this.offersItself(report.available)
					? undefined
					: Object.freeze({ version: report.available.version });
			const latest = report.latest ?? null;
			this.latest =
				latest !== null && this.offersItself(latest)
					? Object.freeze({ ...latest, order: 'same' as const })
					: latest;
		}
		try {
			const outcome = outcomeOf(report.lastResult);
			// A run still under way is not an outcome; the last one stands.
			if (report.lastResult?.outcome !== 'started') this.outcome = outcome;
			// The upgrader that restarted this server has recorded how it ended.
			if (
				this.outcome !== undefined &&
				'at' in this.outcome &&
				this.outcome.at >= this.processStartedAt
			)
				this.disarmSettleTimers();
			this.publish();
		} catch (error) {
			// A report the status cannot carry is a failed check.
			this.report = previous.report;
			this.available = previous.available;
			this.latest = previous.latest;
			this.outcome = previous.outcome;
			throw error;
		}
		// A server that took an attempt up learns only now whether it can hear
		// the upgrader start.
		const pending = this.pending();
		if (
			pending !== undefined &&
			pending.run === undefined &&
			this.bindTimer === undefined &&
			this.canHearRuns()
		)
			this.armDeadlines();
		this.syncWatch();
	}

	/** Whether a release the upgrader offers is the build this process is. */
	private offersItself(release: { readonly revision?: string }): boolean {
		return (
			this.serverRevision !== undefined &&
			release.revision !== undefined &&
			release.revision === this.serverRevision
		);
	}

	/** Bring the published status and attempt in line, and tell clients what
	 * changed. */
	private publish(): void {
		const next = this.derive();
		if (JSON.stringify(next) !== JSON.stringify(this.current)) {
			this.current = next;
			for (const listener of this.listeners) {
				try {
					listener(next);
				} catch {
					/* a failing observer changes nothing about the upgrade */
				}
			}
		}
		const attempt = this.publicAttempt();
		if (JSON.stringify(attempt) !== JSON.stringify(this.currentAttempt)) {
			this.currentAttempt = attempt;
			for (const listener of this.attemptListeners) {
				try {
					listener(attempt);
				} catch {
					/* a failing observer changes nothing about the upgrade */
				}
			}
		}
	}

	/** The attempt as clients read it: its stage while pending, its ending
	 * once ended. */
	private publicAttempt(): ServerUpgradeAttemptState {
		const attempt = this.attempt;
		if (attempt === undefined) return Object.freeze({ attempt: null });
		return parseServerUpgradeAttemptState({
			attempt: {
				id: attempt.id,
				...(attempt.requestId === undefined
					? {}
					: { requestId: attempt.requestId }),
				mode: attempt.mode,
				kind: attempt.kind,
				startedAt: attempt.startedAt,
				expiresAt: attempt.expiresAt,
				...(attempt.ending === undefined
					? { stage: this.stageOf(attempt) }
					: { ending: attempt.ending }),
			},
		});
	}

	/** No run yet: requested. A run this process began during: installing. A
	 * run that began before this process: finishing, as the server it
	 * restarted is this one. */
	private stageOf(attempt: Attempt): ServerUpgradeAttemptStage {
		if (attempt.run === undefined) return 'requested';
		return attempt.run.startedAt < this.processStartedAt
			? 'finishing'
			: 'installing';
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
		// An install record that names another build is about to be rewritten:
		// what it would offer is not news yet.
		const stale = this.recordIsStale();
		return parseServerUpgradeStatus({
			// The process knows what it runs. The install record the upgrader
			// reads is moved to the new release only once this server is ready,
			// so just after an upgrade it still names the release replaced.
			version: this.runningVersion(),
			...(report === undefined ? {} : { channel: report.installed.channel }),
			...(this.available === undefined || stale
				? {}
				: { available: this.available }),
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
			...(report === undefined || this.latest == null || stale
				? {}
				: { latest: this.latestStatus(report, this.latest) }),
			upgrade: this.legacyProgress(),
		});
	}

	/**
	 * The attempt as a client that predates attempts reads it, through the
	 * unchanged status: in progress while pending, then its ending — unless
	 * the upgrader has recorded something newer since.
	 */
	private legacyProgress(): ServerUpgradeProgress {
		const attempt = this.attempt;
		if (attempt !== undefined && attempt.ending === undefined)
			return Object.freeze({
				state: 'in-progress',
				mode: attempt.mode,
				startedAt: attempt.startedAt,
			});
		const ending = attempt?.ending;
		const outcome = this.outcome;
		if (
			ending !== undefined &&
			(outcome === undefined ||
				!('at' in outcome) ||
				ending.at >= outcome.at)
		)
			return progressOf(ending);
		return outcome ?? { state: 'none' };
	}

	/**
	 * The channel's latest release as clients see it, and whether a request
	 * with `allowOlder` can install it here. A system-scope server reaches root
	 * only through the install-latest helper's own request file.
	 */
	private latestStatus(
		report: ServerUpgradeCheckReport,
		latest: NonNullable<ServerUpgradeCheckReport['latest']>,
	) {
		const blocked = report.installLatestUnavailable ?? null;
		const triggerReady =
			report.trigger.kind === 'spawn' ||
			report.trigger.latestPath !== undefined;
		const canInstall =
			latest.order !== 'same' &&
			report.installLatestUnavailable !== undefined &&
			blocked === null &&
			triggerReady;
		return {
			version: latest.version,
			order: latest.order,
			canInstall,
			...(blocked === null
				? {}
				: {
						unavailable: {
							reason: blocked.reason,
							command: blocked.command,
						},
					}),
		};
	}

	private disarmCheckTimer(): void {
		if (this.checkTimer === undefined) return;
		this.cancelInterval(this.checkTimer);
		this.checkTimer = undefined;
	}

	private disarmSettleTimers(): void {
		for (const timer of this.settleTimers) this.cancelTimeout(timer);
		this.settleTimers = [];
	}

	private disarmBindTimer(): void {
		if (this.bindTimer === undefined) return;
		this.cancelTimeout(this.bindTimer);
		this.bindTimer = undefined;
	}

	private disarmDeadlines(): void {
		this.disarmBindTimer();
		if (this.expiryTimer === undefined) return;
		this.cancelTimeout(this.expiryTimer);
		this.expiryTimer = undefined;
	}

	private diagnose(diagnostic: ServerUpgradeDiagnostic): void {
		try {
			this.onDiagnostic?.(diagnostic);
		} catch {
			/* a diagnostic sink cannot affect the check */
		}
	}
}

/** How a run's ending reads to people. Every build on a rolling channel can
 * share one version string, so a short revision tells two apart. */
function endingOf(
	record: ServerUpgradeRunRecord,
	now: number,
): ServerUpgradeEnding {
	let from = record.fromRelease?.version ?? record.from;
	let to = record.toRelease?.version ?? record.to;
	const fromRevision = record.fromRelease?.revision;
	const toRevision = record.toRelease?.revision;
	if (
		from === to &&
		fromRevision !== undefined &&
		toRevision !== undefined &&
		fromRevision !== toRevision
	) {
		from = `${from} (${fromRevision.slice(0, 7)})`;
		to = `${to} (${toRevision.slice(0, 7)})`;
	}
	const at = timeOf(record.at);
	return {
		kind: record.outcome as ServerUpgradeEnding['kind'],
		from: from.slice(0, SERVER_UPGRADE_MAX_VERSION_CHARS),
		to: to.slice(0, SERVER_UPGRADE_MAX_VERSION_CHARS),
		...(record.reason === undefined
			? {}
			: { reason: record.reason.slice(0, SERVER_UPGRADE_MAX_TEXT_CHARS) }),
		at: Number.isFinite(at) && at >= 0 ? at : now,
	};
}

/** An ending as the unchanged status carries it: a run that changed nothing
 * succeeded in place, and a failed one left the running release running. */
function progressOf(ending: ServerUpgradeEnding): ServerUpgradeProgress {
	return ending.kind === 'succeeded' || ending.kind === 'unchanged'
		? Object.freeze({
				state: 'succeeded',
				from: ending.from,
				to: ending.kind === 'unchanged' ? ending.from : ending.to,
				at: ending.at,
			})
		: Object.freeze({
				state: 'failed',
				from: ending.from,
				to: ending.to,
				...(ending.reason === undefined ? {} : { reason: ending.reason }),
				restored: true,
				at: ending.at,
			});
}

function timeOf(value: string | undefined): number {
	return value === undefined ? Number.NaN : Date.parse(value);
}

/** The kept attempt, or undefined when it is not one. */
export function parsePersistedAttempt(value: unknown): Attempt | undefined {
	try {
		if (typeof value !== 'object' || value === null || Array.isArray(value))
			return undefined;
		const record = value as Record<string, unknown>;
		if (record.schemaVersion !== 1) return undefined;
		const from = record.from as Record<string, unknown> | undefined;
		if (
			typeof from !== 'object' ||
			from === null ||
			typeof from.channel !== 'string' ||
			typeof from.version !== 'string' ||
			(from.revision !== undefined && typeof from.revision !== 'string')
		)
			return undefined;
		const run = record.run as Record<string, unknown> | undefined;
		if (
			run !== undefined &&
			(typeof run !== 'object' ||
				run === null ||
				typeof run.id !== 'string' ||
				run.id.length === 0 ||
				run.id.length > 64 ||
				typeof run.startedAt !== 'number' ||
				!Number.isSafeInteger(run.startedAt))
		)
			return undefined;
		// The part clients read is held to the protocol's own rules.
		const { attempt } = parseServerUpgradeAttemptState({
			attempt: {
				id: record.id,
				...(record.requestId === undefined
					? {}
					: { requestId: record.requestId }),
				mode: record.mode,
				kind: record.kind,
				startedAt: record.startedAt,
				expiresAt: record.expiresAt,
				...(record.ending === undefined
					? { stage: 'requested' }
					: { ending: record.ending }),
			},
		});
		if (attempt === null) return undefined;
		return Object.freeze({
			schemaVersion: 1,
			id: attempt.id,
			...(attempt.requestId === undefined
				? {}
				: { requestId: attempt.requestId }),
			mode: attempt.mode,
			kind: attempt.kind,
			startedAt: attempt.startedAt,
			expiresAt: attempt.expiresAt,
			from: Object.freeze({
				channel: from.channel,
				version: from.version,
				...(typeof from.revision === 'string'
					? { revision: from.revision }
					: {}),
			}),
			...(run === undefined
				? {}
				: {
						run: Object.freeze({
							id: run.id as string,
							startedAt: run.startedAt as number,
						}),
					}),
			...(attempt.ending === undefined ? {} : { ending: attempt.ending }),
		});
	} catch {
		return undefined;
	}
}

/** The outcome record the upgrader left, as clients are told it. */
function outcomeOf(
	result: ServerUpgradeCheckReport['lastResult'],
): ServerUpgradeProgress | undefined {
	if (result === null || result.outcome === 'started') return undefined;
	const at = Date.parse(result.at);
	if (!Number.isSafeInteger(at) || at < 0)
		throw new TypeError('upgrade outcome time is invalid');
	return result.outcome === 'succeeded' || result.outcome === 'unchanged'
		? Object.freeze({
				state: 'succeeded',
				from: result.from,
				to: result.outcome === 'unchanged' ? result.from : result.to,
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
