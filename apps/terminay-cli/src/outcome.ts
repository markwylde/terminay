import { chmod, readFile, rename, writeFile } from 'node:fs/promises';

/**
 * What the last upgrade attempt did, written beside the installed versions.
 *
 * An upgrade restarts the server that asked for it, so the process that knows
 * how it ended is never the one that has to tell a client. The upgrader writes
 * this record and the server reads it at its next start; nothing flows the
 * other way. It names releases, an outcome, and a time — no path, account,
 * device, or workspace — and each attempt replaces the one before.
 */

export type UpgradeOutcomeKind = 'succeeded' | 'rolled-back';

export interface UpgradeOutcome {
	readonly schemaVersion: 1;
	/** The release that was running when the attempt began. */
	readonly from: string;
	/** The release it moved to, or tried to. */
	readonly to: string;
	readonly outcome: UpgradeOutcomeKind;
	/** Why the previous release is the one running. Absent on success. */
	readonly reason?: string;
	readonly at: string;
}

export async function writeUpgradeOutcome(
	path: string,
	outcome: Omit<UpgradeOutcome, 'schemaVersion' | 'at'> & {
		readonly at?: string;
	},
): Promise<UpgradeOutcome> {
	const record: UpgradeOutcome = Object.freeze({
		schemaVersion: 1,
		from: outcome.from,
		to: outcome.to,
		outcome: outcome.outcome,
		...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
		at: outcome.at ?? new Date().toISOString(),
	});
	// Replaced by rename, and readable by the account the server runs as: a
	// system-scope upgrade writes it as root for a server that is not.
	const temporary = `${path}.tmp`;
	await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, {
		mode: 0o644,
	});
	await chmod(temporary, 0o644);
	await rename(temporary, path);
	return record;
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
		(record.outcome !== 'succeeded' && record.outcome !== 'rolled-back')
	)
		return undefined;
	return Object.freeze({
		schemaVersion: 1,
		from: record.from,
		to: record.to,
		outcome: record.outcome,
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
