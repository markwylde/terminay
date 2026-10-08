import {
	chmodSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {
	isSessionHolderGeneration,
	SESSION_HOLDER_CLOSE_RECORD_SUFFIX,
	sessionHolderCloseRecordPath,
	sessionHolderDirectory,
} from './paths.js';
import { type HolderCloseNotice, parseHolderCloseNotice } from './protocol.js';

/**
 * The reason a holder closed, left in the data root for a server to report.
 *
 * A holder is detached and has no output anyone reads, and the close that
 * matters most — its unattached limit expiring — happens with no server to
 * tell. The record is owner-only, holds counts and times only, and is removed
 * by the server that reports it.
 */

/** Unreported close records kept for the next server; older ones are dropped. */
export const MAX_HOLDER_CLOSE_RECORDS = 8;

export interface HolderCloseRecord {
	readonly generation: string;
	readonly notice: HolderCloseNotice;
}

export function writeHolderCloseRecord(
	dataRoot: string,
	generation: string,
	notice: HolderCloseNotice,
): void {
	const target = sessionHolderCloseRecordPath(dataRoot, generation);
	const temporary = `${target}.tmp`;
	writeFileSync(temporary, JSON.stringify(notice), { mode: 0o600 });
	chmodSync(temporary, 0o600);
	renameSync(temporary, target);
}

/** Every readable close record, oldest close first. */
export function readHolderCloseRecords(
	dataRoot: string,
): readonly HolderCloseRecord[] {
	let names: string[];
	try {
		names = readdirSync(sessionHolderDirectory(dataRoot));
	} catch {
		return [];
	}
	const records: HolderCloseRecord[] = [];
	for (const name of names) {
		if (!name.endsWith(SESSION_HOLDER_CLOSE_RECORD_SUFFIX)) continue;
		const generation = name.slice(
			0,
			-SESSION_HOLDER_CLOSE_RECORD_SUFFIX.length,
		);
		if (!isSessionHolderGeneration(generation)) continue;
		try {
			const notice = parseHolderCloseNotice(
				JSON.parse(
					readFileSync(
						sessionHolderCloseRecordPath(dataRoot, generation),
						'utf8',
					),
				),
			);
			if (notice !== undefined) {
				records.push({ generation, notice });
				continue;
			}
		} catch {
			/* unreadable: removed below */
		}
		// A record nobody can read would otherwise stay for ever.
		deleteHolderCloseRecord(dataRoot, generation);
	}
	return records.sort(
		(left, right) => left.notice.closedAt - right.notice.closedAt,
	);
}

export function deleteHolderCloseRecord(
	dataRoot: string,
	generation: string,
): void {
	rmSync(sessionHolderCloseRecordPath(dataRoot, generation), { force: true });
}
