import type { JsonValue } from '@terminay/protocol';
import { THIS_SERVER_ENVIRONMENT_ID } from '../workspace.js';
import {
	PROJECT_ENVIRONMENT_CAPABILITIES,
	PROJECT_ENVIRONMENT_SCHEMA_VERSION,
	PROJECT_ENVIRONMENT_STATUSES,
	THIS_SERVER_PROVIDER_ID,
	type EnvironmentConfigurationRevision,
	type EnvironmentProfile,
	type ProjectEnvironmentRecord,
	type ProjectEnvironmentState,
	type ProjectEnvironmentSummary,
} from './types.js';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function canonicalizeProjectEnvironmentState(input: unknown, expectedServerId: string): ProjectEnvironmentState {
	if (!record(input)) throw new TypeError('project environment registry must be an object');
	if (input.schemaVersion !== PROJECT_ENVIRONMENT_SCHEMA_VERSION || input.serverId !== expectedServerId || !revision(input.revision) || input.cursor !== String(input.revision) || !record(input.profiles) || !record(input.environments) || !record(input.operations))
		throw new TypeError('invalid project environment registry schema');
	const profiles: Record<string, EnvironmentProfile> = {};
	for (const [id, value] of Object.entries(input.profiles)) profiles[id] = profile(id, value);
	const environments: Record<string, ProjectEnvironmentRecord> = {};
	for (const [id, value] of Object.entries(input.environments)) environments[id] = environment(id, value, profiles);
	const operations: Record<string, import('./types.js').ProjectEnvironmentOperationRecord> = {};
	for (const [id, value] of Object.entries(input.operations)) operations[id] = operation(id, value, environments);
	const local = environments[THIS_SERVER_ENVIRONMENT_ID];
	if (local === undefined || local.providerId !== THIS_SERVER_PROVIDER_ID || !local.builtIn || local.archived || local.status !== 'ready')
		throw new TypeError('reserved This server environment is invalid');
	return structuredClone({ schemaVersion: PROJECT_ENVIRONMENT_SCHEMA_VERSION, serverId: expectedServerId, revision: input.revision, cursor: input.cursor, profiles, environments, operations });
}

export function toProjectEnvironmentSummary(value: ProjectEnvironmentRecord): ProjectEnvironmentSummary {
	return Object.freeze({
		id: value.id,
		providerId: value.providerId,
		...(value.profileId === undefined ? {} : { profileId: value.profileId }),
		pinnedRevision: value.pinnedRevision,
		name: value.name,
		endpointSummary: value.endpointSummary,
		...(value.defaultRoot === undefined ? {} : { defaultRoot: value.defaultRoot }),
		capabilities: Object.freeze([...value.availableCapabilities]),
		status: value.status,
		...(value.failure === undefined ? {} : { failure: Object.freeze({ ...value.failure }) }),
		archived: value.archived,
		builtIn: value.builtIn,
	});
}

function profile(id: string, input: unknown): EnvironmentProfile {
	if (!record(input) || input.id !== id || !identifier(id) || !providerIdentifier(input.providerId) || !text(input.name, 256) || !text(input.endpointSummary, 512) || !positiveRevision(input.activeRevision) || !positiveRevision(input.recommendedRevision) || input.recommendedRevision < input.activeRevision || !record(input.revisions) || typeof input.archived !== 'boolean') throw new TypeError(`invalid environment profile ${id}`);
	const revisions: Record<string, EnvironmentConfigurationRevision> = {};
	for (const [key, raw] of Object.entries(input.revisions)) {
		if (!record(raw) || !positiveRevision(raw.revision) || key !== String(raw.revision) || !timestamp(raw.createdAt) || !json(raw.configuration) || !stringList(raw.secretReferences, 512)) throw new TypeError(`invalid environment profile revision ${id}:${key}`);
		revisions[key] = { revision: raw.revision, createdAt: raw.createdAt, configuration: structuredClone(raw.configuration) as JsonValue, secretReferences: [...raw.secretReferences] };
	}
	if (revisions[String(input.activeRevision)] === undefined || revisions[String(input.recommendedRevision)] === undefined) throw new TypeError(`environment profile ${id} references a missing revision`);
	let presentation: Record<string, string> | undefined;
	if (input.presentation !== undefined) {
		if (!record(input.presentation) || Object.keys(input.presentation).length > 32) throw new TypeError(`invalid environment profile presentation ${id}`);
		presentation = {};
		for (const [key, value] of Object.entries(input.presentation)) {
			if (!text(key, 64) || !text(value, 256)) throw new TypeError(`invalid environment profile presentation ${id}`);
			presentation[key] = value;
		}
	}
	return { id, providerId: input.providerId, name: input.name, endpointSummary: input.endpointSummary, ...(input.defaultRoot === undefined ? {} : { defaultRoot: path(input.defaultRoot) }), activeRevision: input.activeRevision, recommendedRevision: input.recommendedRevision, revisions, ...(presentation === undefined ? {} : { presentation }), archived: input.archived };
}

function environment(id: string, input: unknown, profiles: Readonly<Record<string, EnvironmentProfile>>): ProjectEnvironmentRecord {
	if (!record(input) || input.id !== id || !identifier(id) || !providerIdentifier(input.providerId) || !positiveRevision(input.pinnedRevision) || !text(input.name, 256) || !text(input.endpointSummary, 512) || !capabilities(input.declaredCapabilities) || !capabilities(input.availableCapabilities) || input.availableCapabilities.some((value) => !input.declaredCapabilities.includes(value)) || !PROJECT_ENVIRONMENT_STATUSES.includes(input.status as never) || !stringList(input.operationReferences, 128) || !revision(input.projectReferenceCount) || typeof input.archived !== 'boolean' || typeof input.builtIn !== 'boolean' || !json(input.providerState) || !positiveRevision(input.providerRevision)) throw new TypeError(`invalid project environment ${id}`);
	if (input.profileId !== undefined && (!identifier(input.profileId) || profiles[input.profileId] === undefined || profiles[input.profileId]?.providerId !== input.providerId)) throw new TypeError(`environment ${id} has invalid profile ownership`);
	if (input.failure !== undefined && (!record(input.failure) || !PROJECT_ENVIRONMENT_STATUSES.includes(input.failure.classification as never) || !text(input.failure.message, 512) || typeof input.failure.retryable !== 'boolean')) throw new TypeError(`invalid project environment failure ${id}`);
	if (input.lastSuccessfulCheck !== undefined && !timestamp(input.lastSuccessfulCheck)) throw new TypeError(`invalid project environment check time ${id}`);
	return structuredClone({ ...input, ...(input.defaultRoot === undefined ? {} : { defaultRoot: path(input.defaultRoot) }) }) as unknown as ProjectEnvironmentRecord;
}

function operation(id: string, input: unknown, environments: Readonly<Record<string, ProjectEnvironmentRecord>>): import('./types.js').ProjectEnvironmentOperationRecord {
	if (!record(input) || input.id !== id || !identifier(id) || !providerIdentifier(input.providerId) || !identifier(input.environmentId) || environments[input.environmentId]?.providerId !== input.providerId || !text(input.kind,128) || !['pending','running','succeeded','failed','cancelled'].includes(input.state) || !json(input.providerState) || !timestamp(input.createdAt) || !timestamp(input.updatedAt) || input.updatedAt < input.createdAt || !positiveRevision(input.revision)) throw new TypeError(`invalid project environment operation ${id}`);
	if (input.providerOperationId !== undefined && !identifier(input.providerOperationId)) throw new TypeError(`invalid provider operation identity ${id}`);
	if (input.progress !== undefined && !json(input.progress)) throw new TypeError(`invalid provider operation progress ${id}`);
	if (JSON.stringify(input.providerState).length > 262144 || (input.progress !== undefined && JSON.stringify(input.progress).length > 262144)) throw new TypeError(`project environment operation ${id} is too large`);
	return structuredClone(input) as import('./types.js').ProjectEnvironmentOperationRecord;
}

function record(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function identifier(value: unknown): value is string { return typeof value === 'string' && ID.test(value); }
function providerIdentifier(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,126}\/[A-Za-z0-9][A-Za-z0-9._:-]{0,126}$/.test(value) || identifier(value); }
function revision(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function positiveRevision(value: unknown): value is number { return revision(value) && value > 0; }
function timestamp(value: unknown): value is number { return revision(value); }
function text(value: unknown, max: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\0'); }
function path(value: unknown): string { if (!text(value, 4096)) throw new TypeError('invalid environment path'); return value; }
function stringList(value: unknown, maxLength: number): value is string[] { return Array.isArray(value) && value.length <= maxLength && new Set(value).size === value.length && value.every((entry) => text(entry, 512)); }
function capabilities(value: unknown): value is ProjectEnvironmentRecord['declaredCapabilities'] { return Array.isArray(value) && new Set(value).size === value.length && value.every((entry) => PROJECT_ENVIRONMENT_CAPABILITIES.includes(entry)); }
function json(value: unknown): boolean {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
	if (typeof value === 'number') return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(json);
	return record(value) && Object.values(value).every(json);
}
