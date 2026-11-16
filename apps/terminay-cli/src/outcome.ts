import { randomUUID } from 'node:crypto';
import { chmod, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * What the last upgrade run did, written beside the installed versions.
 *
 * An upgrade restarts the server that asked for it, so the process that knows
 * how it ended is never the one that has to tell a client. Every run that may
 * change the install records that it started and then exactly one ending,
 * both under its own run id, so a server can tell its attempt's run from any
 * other (ADR-0125). It names releases, an outcome, and a time — no path,
 * account, device, or workspace — and each record replaces the one before.
 */

export type UpgradeEndingKind =
	| 'succeeded'
	| 'rolled-back'
	| 'unchanged'
	| 'failed';
export type UpgradeOutcomeKind = 'started' | UpgradeEndingKind;

/** A release named the way a build is told apart: by its revision. */
export interface ReleaseName {
	readonly channel: string;
	readonly version: string;
	readonly revision: string;
}

export interface UpgradeOutcome {
	readonly schemaVersion: 1;
	/** The run this record belongs to. Absent from a record written before
	 * runs had ids. */
	readonly run?: string;
	/** When the run began, on its start record and its ending alike, so a
	 * reader that sees only the ending still knows when its run started. */
	readonly runStartedAt?: string;
	/** The release that was running when the run began, as a label. */
	readonly from: string;
	/** The release it moved to, or tried to, as a label. */
	readonly to: string;
	readonly fromRelease?: ReleaseName;
	readonly toRelease?: ReleaseName;
	readonly outcome: UpgradeOutcomeKind;
	/** Why the run did not succeed. */
	readonly reason?: string;
	readonly at: string;
}

const KINDS: readonly UpgradeOutcomeKind[] = [
	'started',
	'succeeded',
	'rolled-back',
	'unchanged',
	'failed',
];

export async function writeUpgradeOutcome(
	path: string,
	outcome: Omit<UpgradeOutcome, 'schemaVersion' | 'at'> & {
		readonly at?: string;
	},
): Promise<UpgradeOutcome> {
	const record: UpgradeOutcome = Object.freeze({
		schemaVersion: 1,
		...(outcome.run === undefined ? {} : { run: outcome.run }),
		...(outcome.runStartedAt === undefined
			? {}
			: { runStartedAt: outcome.runStartedAt }),
		from: outcome.from,
		to: outcome.to,
		...(outcome.fromRelease === undefined
			? {}
			: { fromRelease: releaseName(outcome.fromRelease) }),
		...(outcome.toRelease === undefined
			? {}
			: { toRelease: releaseName(outcome.toRelease) }),
		outcome: outcome.outcome,
		...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
		at: outcome.at ?? new Date().toISOString(),
	});
	// Replaced by rename, and readable by the account the server runs as: a
	// system-scope upgrade writes it as root for a server that is not. The
	// temporary name is this write's own, so two writers never share one.
	const temporary = join(
		dirname(path),
		`.upgrade-result.${process.pid}.${randomUUID()}.tmp`,
	);
	try {
		await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, {
			mode: 0o644,
		});
		await chmod(temporary, 0o644);
		await rename(temporary, path);
	} catch (error) {
		await unlink(temporary).catch(() => undefined);
		throw error;
	}
	return record;
}

function releaseName(release: ReleaseName): ReleaseName {
	return Object.freeze({
		channel: release.channel,
		version: release.version,
		revision: release.revision,
	});
}

function readRelease(value: unknown): ReleaseName | undefined {
	if (typeof value !== 'object' || value === null) return undefined;
	const record = value as Record<string, unknown>;
	if (
		typeof record.channel !== 'string' ||
		typeof record.version !== 'string' ||
		typeof record.revision !== 'string'
	)
		return undefined;
	return releaseName(record as unknown as ReleaseName);
}

/** Absent, unreadable, or not this shape all read as "no attempt on record". */
export async function readUpgradeOutcome(
	path: string,
): Promise<UpgradeOutcome | undefined> {
	const raw = await readFile(path, 'utf8').catch(() => undefined);
	if (raw === undefined) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (typeof parsed !== 'object' || parsed === null) return undefined;
	const record = parsed as Record<string, unknown>;
	if (
		record.schemaVersion !== 1 ||
		typeof record.from !== 'string' ||
		typeof record.to !== 'string' ||
		typeof record.at !== 'string' ||
		!(KINDS as readonly unknown[]).includes(record.outcome) ||
		(record.run !== undefined && typeof record.run !== 'string') ||
		(record.runStartedAt !== undefined &&
			typeof record.runStartedAt !== 'string')
	)
		return undefined;
	const fromRelease = readRelease(record.fromRelease);
	const toRelease = readRelease(record.toRelease);
	return Object.freeze({
		schemaVersion: 1,
		...(typeof record.run === 'string' ? { run: record.run } : {}),
		...(typeof record.runStartedAt === 'string'
			? { runStartedAt: record.runStartedAt }
			: {}),
		from: record.from,
		to: record.to,
		...(fromRelease === undefined ? {} : { fromRelease }),
		...(toRelease === undefined ? {} : { toRelease }),
		outcome: record.outcome as UpgradeOutcomeKind,
		...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
		at: record.at,
	});
}

/**
 * The name an outcome gives a release. A tagged release is its version; the
 * rolling channel reuses one version string for every build, so there it is
 * the name the version is staged under, which carries the commit.
 */
export function releaseLabel(
	channel: string,
	version: string,
	revision: string | undefined,
): string {
	if (channel === 'tag' || revision === undefined) return version;
	return `${channel}-${revision.slice(0, 12)}`;
}

export function labelOf(release: ReleaseName): string {
	return releaseLabel(release.channel, release.version, release.revision);
}

/** Another upgrade holds the install. Nothing was recorded or changed. */
export class UpgradeLockedError extends Error {}

/**
 * One upgrade run on an install: it holds the install-wide lock, has an id,
 * and records its start and exactly one ending (ADR-0125).
 */
export class UpgradeRun {
	readonly id = randomUUID();
	readonly startedAt = new Date().toISOString();
	private ending: UpgradeEndingKind | undefined;

	private constructor(
		private readonly resultPath: string,
		private readonly lockPath: string,
		readonly from: ReleaseName,
	) {}

	/**
	 * Take the install's lock and record the start. A lock whose holder is
	 * gone is taken over; one whose holder still runs refuses the run.
	 */
	static async begin(options: {
		readonly resultPath: string;
		readonly from: ReleaseName;
		readonly isRunning?: (pid: number) => boolean;
	}): Promise<UpgradeRun> {
		const lockPath = join(dirname(options.resultPath), UPGRADE_LOCK);
		await takeLock(lockPath, options.isRunning ?? processIsRunning);
		const run = new UpgradeRun(options.resultPath, lockPath, options.from);
		try {
			await writeUpgradeOutcome(options.resultPath, {
				run: run.id,
				runStartedAt: run.startedAt,
				from: labelOf(options.from),
				to: labelOf(options.from),
				fromRelease: options.from,
				outcome: 'started',
				at: run.startedAt,
			});
		} catch (error) {
			await run.release();
			throw error;
		}
		return run;
	}

	get ended(): UpgradeEndingKind | undefined {
		return this.ending;
	}

	/**
	 * Record how the run ended. Only the first ending is written: an ending is
	 * final once recorded, and nothing later replaces it.
	 */
	async end(
		kind: UpgradeEndingKind,
		details: {
			readonly to?: ReleaseName;
			/** The target's name, when it is known only by a label. */
			readonly toLabel?: string;
			readonly reason?: string;
		} = {},
	): Promise<void> {
		if (this.ending !== undefined) return;
		this.ending = kind;
		const to =
			details.to ?? (details.toLabel === undefined ? this.from : undefined);
		await writeUpgradeOutcome(this.resultPath, {
			run: this.id,
			runStartedAt: this.startedAt,
			from: labelOf(this.from),
			to: to === undefined ? (details.toLabel as string) : labelOf(to),
			fromRelease: this.from,
			...(to === undefined ? {} : { toRelease: to }),
			outcome: kind,
			...(details.reason === undefined ? {} : { reason: details.reason }),
		});
	}

	async release(): Promise<void> {
		await unlink(this.lockPath).catch(() => undefined);
	}
}

export const UPGRADE_LOCK = 'upgrade.lock';

function processIsRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// Running under another account still counts as running.
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}

async function takeLock(
	lockPath: string,
	isRunning: (pid: number) => boolean,
): Promise<void> {
	const content = `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`;
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			await writeFile(lockPath, content, { flag: 'wx', mode: 0o644 });
			return;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
		}
		const holder = await readFile(lockPath, 'utf8')
			.then((raw) => JSON.parse(raw) as { pid?: unknown })
			.catch(() => undefined);
		const pid = holder?.pid;
		if (
			typeof pid === 'number' &&
			Number.isSafeInteger(pid) &&
			pid > 0 &&
			pid !== process.pid &&
			isRunning(pid)
		)
			throw new UpgradeLockedError(
				`another upgrade is running on this install (process ${pid}). If it is not, remove ${lockPath} and try again.`,
			);
		// Its holder is gone: the lock is left over, and taken over.
		await unlink(lockPath).catch(() => undefined);
	}
	throw new UpgradeLockedError(
		`another upgrade took the lock on this install at the same moment. Remove ${lockPath} if no upgrade is running, and try again.`,
	);
}
