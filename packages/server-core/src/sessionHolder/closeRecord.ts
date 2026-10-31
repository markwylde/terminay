import { readdirSync, rmSync } from 'node:fs';
import {
	loadRebuildableStateSync,
	writeFileDurablySync,
} from '../durableFile.js';
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
	writeFileDurablySync(
		sessionHolderCloseRecordPath(dataRoot, generation),
		JSON.stringify(notice),
		{ mode: 0o600 },
	);
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
		// A corrupt record is set aside under a name this loop never reads
		// again, and kept for diagnosis (ADR-0088).
		try {
			const notice = loadRebuildableStateSync(
				sessionHolderCloseRecordPath(dataRoot, generation),
				'holder-close-record',
				{ validate: parseHolderCloseNotice },
			);
			if (notice !== undefined) records.push({ generation, notice });
		} catch {
			/* not even movable aside: skipped, startup continues */
		}
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
