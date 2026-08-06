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
