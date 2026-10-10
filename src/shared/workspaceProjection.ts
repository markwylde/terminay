import {
	parseWorkspaceChangeRecordDto,
	parseWorkspaceDeltaDto,
	parseWorkspaceRecordsDeltaDto,
	WORKSPACE_COLLECTION_NAMES,
	WORKSPACE_RECORDS_DELTA_VERSION,
	type WorkspaceChangeRecordDto,
	type WorkspaceCollectionName,
	workspaceDeltaVersionOf,
} from '@terminay/protocol';
import {
	parseServerWorkspaceSnapshot,
	type ServerWorkspaceSnapshot,
} from './serverWorkspaceReconciliation';
import { sameJsonValue } from './sameJsonValue.ts';

export { sameJsonValue };

/**
 * How a client's workspace projection advances (ADR-0059).
 *
 * Whatever a change arrives as (the change record on its event, the records of
 * a delta, or a whole snapshot), the projection that results shares with the
 * one before it every object the change left alone. An unchanged project,
 * folder, panel, view, or session is then the same object before and after,
 * and that identity is how everything downstream knows it has nothing to do.
 */

type Collection = Readonly<Record<string, unknown>>;

/** `next`, with every member equal to `previous`'s replaced by `previous`'s,
 * and `previous` itself when nothing differs. */
function shareCollection(previous: Collection, next: Collection): Collection {
	const shared: Record<string, unknown> = {};
	const ids = Object.keys(next);
	let same = ids.length === Object.keys(previous).length;
	for (const id of ids) {
		const held = previous[id];
		if (held !== undefined && sameJsonValue(held, next[id])) {
			shared[id] = held;
			continue;
		}
		shared[id] = next[id];
		same = false;
	}
	return same ? previous : shared;
}

/**
 * A snapshot that arrived whole, made to share with the projection already
 * held every object that is the same in both. A reconnect or a recovery then
 * disturbs only what actually changed while the client was away.
 */
export function shareUnchangedWorkspaceObjects(
	previous: ServerWorkspaceSnapshot | null,
	snapshot: ServerWorkspaceSnapshot,
): ServerWorkspaceSnapshot {
	if (previous === null || previous === snapshot) return snapshot;
	const shared: Record<string, unknown> = { ...snapshot };
	for (const collection of WORKSPACE_COLLECTION_NAMES)
		shared[collection] = shareCollection(
			previous[collection] as Collection,
			snapshot[collection] as Collection,
		);
	if (sameJsonValue(previous.viewOrder, snapshot.viewOrder))
		shared.viewOrder = previous.viewOrder;
	return shared as unknown as ServerWorkspaceSnapshot;
}

/** Thrown when a record does not start from the revision the client holds:
 * the client missed a change, and asks for the ones since its own revision. */
export class WorkspaceChangeGapError extends Error {
	constructor(heldRevision: number, fromRevision: number) {
		super(
			`workspace change starts from revision ${fromRevision}, not the held revision ${heldRevision}`,
		);
		this.name = 'WorkspaceChangeGapError';
	}
}

function applyRecord(
	previous: ServerWorkspaceSnapshot,
	record: WorkspaceChangeRecordDto,
): ServerWorkspaceSnapshot {
	if (record.fromRevision !== previous.revision)
		throw new WorkspaceChangeGapError(previous.revision, record.fromRevision);
	const next: Record<string, unknown> = {
		...previous,
		revision: record.revision,
		cursor: record.cursor,
	};
	const touched = new Set<WorkspaceCollectionName>([
		...(Object.keys(record.changed) as WorkspaceCollectionName[]),
		...(Object.keys(record.removed) as WorkspaceCollectionName[]),
	]);
	for (const collection of touched) {
		const members: Record<string, unknown> = { ...previous[collection] };
		for (const id of record.removed[collection] ?? []) delete members[id];
		Object.assign(members, record.changed[collection]);
		next[collection] = members;
	}
	if (record.viewOrder !== undefined) next.viewOrder = record.viewOrder;
	return next as unknown as ServerWorkspaceSnapshot;
}

/**
 * The projection that results from applying an ordered run of change records
 * to the one held. All or nothing: every record is validated and must start
 * where the one before it ended, and the result is validated as a snapshot
 * before it is returned, so a caller never holds a half-applied projection.
 */
export function applyWorkspaceChangeRecords(
	previous: ServerWorkspaceSnapshot,
	records: readonly unknown[],
	expectedServerId: string,
): ServerWorkspaceSnapshot {
	if (records.length === 0) return previous;
	let next = previous;
	for (const candidate of records)
		next = applyRecord(next, parseWorkspaceChangeRecordDto(candidate));
	return parseServerWorkspaceSnapshot(next, expectedServerId, previous);
}

/**
 * The projection a `workspace.delta` reply leads to, in either of its
 * versions: records applied to the projection held, or a whole state shared
 * with it.
 */
export function advanceByWorkspaceDelta(
	previous: ServerWorkspaceSnapshot,
	value: unknown,
	expectedServerId: string,
): ServerWorkspaceSnapshot {
	const expected = {
		serverId: expectedServerId,
		revision: previous.revision,
		cursor: previous.cursor,
	};
	if (workspaceDeltaVersionOf(value) === WORKSPACE_RECORDS_DELTA_VERSION) {
		const delta = parseWorkspaceRecordsDeltaDto(value, expected);
		if (delta.records !== undefined)
			return applyWorkspaceChangeRecords(
				previous,
				delta.records,
				expectedServerId,
			);
		return shareUnchangedWorkspaceObjects(
			previous,
			parseServerWorkspaceSnapshot(delta.state, expectedServerId, previous),
		);
	}
	const delta = parseWorkspaceDeltaDto(value, expected);
	const state = parseServerWorkspaceSnapshot(
		delta.state,
		expectedServerId,
		previous,
	);
	if (delta.revision !== state.revision || delta.cursor !== state.cursor)
		throw new Error(
			'The server returned a workspace delta that disagrees with its state.',
		);
	for (const event of delta.events)
		if (
			event.revision <= previous.revision ||
			event.revision > state.revision
		)
			throw new Error('The server returned an out-of-bounds workspace change.');
	return shareUnchangedWorkspaceObjects(previous, state);
}

/** What a projection's listeners are handed beside the projection: the one
 * before it. An object is unchanged exactly when it is the same object in
 * both, so a listener compares what it depends on and returns. */
export type WorkspaceProjectionChange = Readonly<{
	previous: ServerWorkspaceSnapshot | null;
}>;
