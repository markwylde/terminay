import type { JsonValue } from './errors.js';
import type { ProtocolId } from './types.js';

export const WORKSPACE_DELTA_VERSION = 1 as const;

export interface WorkspaceSnapshotDto {
	readonly schemaVersion: number;
	readonly serverId: ProtocolId;
	readonly revision: number;
	readonly cursor: string;
	readonly [key: string]: JsonValue;
}

export interface WorkspaceChangeEventDto {
	readonly revision: number;
	readonly cursor: string;
	readonly commandId: ProtocolId;
	readonly type: string;
	readonly changedIds: readonly ProtocolId[];
}

/** The one wire representation returned by workspace.delta. The requested
 * boundary is carried in the response so a delayed or crossed response cannot
 * be applied to a different cached projection. */
export interface WorkspaceDeltaDto {
	readonly deltaVersion: typeof WORKSPACE_DELTA_VERSION;
	readonly serverId: ProtocolId;
	readonly fromRevision: number;
	readonly fromCursor: string;
	readonly revision: number;
	readonly cursor: string;
	readonly state: WorkspaceSnapshotDto;
	readonly events: readonly WorkspaceChangeEventDto[];
}

export function parseWorkspaceSnapshotDto(value: unknown): WorkspaceSnapshotDto {
	if (!isRecord(value)
		|| !isPositiveSafeInteger(value.schemaVersion)
		|| !isBoundedId(value.serverId)
		|| !isRevision(value.revision)
		|| value.cursor !== String(value.revision)) {
		throw new TypeError('invalid workspace snapshot');
	}
	return value as WorkspaceSnapshotDto;
}

export function parseWorkspaceDeltaDto(
	value: unknown,
	expected?: Readonly<{ serverId: string; revision: number; cursor: string }>,
): WorkspaceDeltaDto {
	if (!isRecord(value)
		|| value.deltaVersion !== WORKSPACE_DELTA_VERSION
		|| !isBoundedId(value.serverId)
		|| !isRevision(value.fromRevision)
		|| value.fromCursor !== String(value.fromRevision)
		|| !isRevision(value.revision)
		|| value.cursor !== String(value.revision)
		|| value.revision < value.fromRevision
		|| !Array.isArray(value.events)) {
		throw new TypeError('invalid workspace delta');
	}
	if (expected !== undefined && (value.serverId !== expected.serverId
		|| value.fromRevision !== expected.revision
		|| value.fromCursor !== expected.cursor)) {
		throw new TypeError('workspace delta does not match the requested projection');
	}
	const state = parseWorkspaceSnapshotDto(value.state);
	if (state.serverId !== value.serverId || state.revision !== value.revision || state.cursor !== value.cursor) {
		throw new TypeError('workspace delta state does not match its envelope');
	}
	let priorRevision = value.fromRevision;
	for (const candidate of value.events) {
		if (!isRecord(candidate)
			|| !isRevision(candidate.revision)
			|| candidate.revision <= priorRevision
			|| candidate.revision > value.revision
			|| candidate.cursor !== String(candidate.revision)
			|| !isBoundedId(candidate.commandId)
			|| typeof candidate.type !== 'string'
			|| candidate.type.length === 0
			|| candidate.type.length > 128
			|| !Array.isArray(candidate.changedIds)
			|| candidate.changedIds.some((id) => !isBoundedId(id))) {
			throw new TypeError('invalid workspace delta event');
		}
		priorRevision = candidate.revision;
	}
	return value as unknown as WorkspaceDeltaDto;
}

/** The second delta version: change records in place of the resulting state. */
export const WORKSPACE_RECORDS_DELTA_VERSION = 2 as const;

/** The collections of a workspace snapshot whose members are objects by id. */
export const WORKSPACE_COLLECTION_NAMES = Object.freeze([
	'views',
	'projects',
	'folders',
	'panels',
	'terminalSessions',
] as const);
export type WorkspaceCollectionName = (typeof WORKSPACE_COLLECTION_NAMES)[number];

/** Bounds a peer's record before any of it is trusted. */
export const WORKSPACE_CHANGE_RECORD_MAX_OBJECTS = 16_384;

/**
 * What one commit changed, as the receiving connection may see it: every
 * object whose content differs between the two revisions, in full, and the id
 * of every object that is gone. Applying it to the snapshot at `fromRevision`
 * yields the snapshot at `revision`.
 */
export interface WorkspaceChangeRecordDto {
	readonly fromRevision: number;
	readonly revision: number;
	readonly cursor: string;
	/** The committed command's type. Absent for a connection the record was
	 * scoped for, which is not told what happened outside its scope. */
	readonly type?: string;
	readonly changed: {
		readonly [K in WorkspaceCollectionName]?: Readonly<
			Record<ProtocolId, { readonly [key: string]: JsonValue }>
		>;
	};
	readonly removed: {
		readonly [K in WorkspaceCollectionName]?: readonly ProtocolId[];
	};
	/** Present when the order of views changed. */
	readonly viewOrder?: readonly ProtocolId[];
}

/**
 * The answer to `workspace.delta` for a peer that negotiated
 * `workspace-changes.v1`: the ordered records since the requested revision, or
 * a complete snapshot when the server no longer holds them all.
 */
export type WorkspaceRecordsDeltaDto = {
	readonly deltaVersion: typeof WORKSPACE_RECORDS_DELTA_VERSION;
	readonly serverId: ProtocolId;
	readonly fromRevision: number;
	readonly fromCursor: string;
	readonly revision: number;
	readonly cursor: string;
} & (
	| {
			readonly records: readonly WorkspaceChangeRecordDto[];
			readonly state?: undefined;
	  }
	| { readonly state: WorkspaceSnapshotDto; readonly records?: undefined }
);

export function parseWorkspaceChangeRecordDto(
	value: unknown,
): WorkspaceChangeRecordDto {
	if (!isRecord(value)
		|| !isRevision(value.fromRevision)
		|| !isRevision(value.revision)
		|| value.revision !== value.fromRevision + 1
		|| value.cursor !== String(value.revision)
		|| (value.type !== undefined && (typeof value.type !== 'string' || value.type.length === 0 || value.type.length > 128))
		|| !isRecord(value.changed)
		|| !isRecord(value.removed)) {
		throw new TypeError('invalid workspace change record');
	}
	let objects = 0;
	const known = new Set<string>(WORKSPACE_COLLECTION_NAMES);
	for (const [collection, members] of Object.entries(value.changed)) {
		if (!known.has(collection) || !isRecord(members))
			throw new TypeError('invalid workspace change record');
		for (const [id, member] of Object.entries(members)) {
			objects += 1;
			if (objects > WORKSPACE_CHANGE_RECORD_MAX_OBJECTS || !isBoundedId(id) || !isRecord(member) || member.id !== id)
				throw new TypeError('invalid workspace change record');
		}
	}
	for (const [collection, ids] of Object.entries(value.removed)) {
		if (!known.has(collection) || !Array.isArray(ids))
			throw new TypeError('invalid workspace change record');
		const changed = value.changed[collection];
		for (const id of ids) {
			objects += 1;
			if (objects > WORKSPACE_CHANGE_RECORD_MAX_OBJECTS || !isBoundedId(id) || (isRecord(changed) && Object.hasOwn(changed, id)))
				throw new TypeError('invalid workspace change record');
		}
	}
	if (value.viewOrder !== undefined
		&& (!Array.isArray(value.viewOrder) || value.viewOrder.some((id) => !isBoundedId(id)))) {
		throw new TypeError('invalid workspace change record');
	}
	return value as unknown as WorkspaceChangeRecordDto;
}

export function parseWorkspaceRecordsDeltaDto(
	value: unknown,
	expected?: Readonly<{ serverId: string; revision: number; cursor: string }>,
): WorkspaceRecordsDeltaDto {
	if (!isRecord(value)
		|| value.deltaVersion !== WORKSPACE_RECORDS_DELTA_VERSION
		|| !isBoundedId(value.serverId)
		|| !isRevision(value.fromRevision)
		|| value.fromCursor !== String(value.fromRevision)
		|| !isRevision(value.revision)
		|| value.cursor !== String(value.revision)
		|| value.revision < value.fromRevision
		|| (value.records === undefined) === (value.state === undefined)) {
		throw new TypeError('invalid workspace delta');
	}
	if (expected !== undefined && (value.serverId !== expected.serverId
		|| value.fromRevision !== expected.revision
		|| value.fromCursor !== expected.cursor)) {
		throw new TypeError('workspace delta does not match the requested projection');
	}
	if (value.state !== undefined) {
		const state = parseWorkspaceSnapshotDto(value.state);
		if (state.serverId !== value.serverId || state.revision !== value.revision || state.cursor !== value.cursor)
			throw new TypeError('workspace delta state does not match its envelope');
		return value as unknown as WorkspaceRecordsDeltaDto;
	}
	if (!Array.isArray(value.records) || value.records.length !== value.revision - value.fromRevision)
		throw new TypeError('invalid workspace delta');
	// The records are a chain: each starts where the one before it ended.
	let revision = value.fromRevision;
	for (const candidate of value.records) {
		const record = parseWorkspaceChangeRecordDto(candidate);
		if (record.fromRevision !== revision)
			throw new TypeError('workspace delta records are not contiguous');
		revision = record.revision;
	}
	return value as unknown as WorkspaceRecordsDeltaDto;
}

/** The version of a `workspace.delta` reply, read before it is parsed. */
export function workspaceDeltaVersionOf(value: unknown): number | undefined {
	return isRecord(value) && typeof value.deltaVersion === 'number'
		? value.deltaVersion
		: undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isRevision(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function isPositiveSafeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function isBoundedId(value: unknown): value is ProtocolId {
	return typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9._:@/-]+$/u.test(value);
}
