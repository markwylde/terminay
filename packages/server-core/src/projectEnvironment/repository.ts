import type { ProjectEnvironmentState } from './types.js';
import { createInitialProjectEnvironmentState, PROJECT_ENVIRONMENT_SCHEMA_VERSION } from './types.js';
import { canonicalizeProjectEnvironmentState, projectEnvironmentRegistryHasOrphanedProfileRecords, projectEnvironmentRegistryHasUnknownCapabilities } from './validation.js';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface ProjectEnvironmentStateBackend {
	load(): Promise<unknown | undefined>;
	commit(state: ProjectEnvironmentState): Promise<void>;
	backup?(state: ProjectEnvironmentState): Promise<void>;
}

/** Revision-checked persistence boundary. Backends provide their platform's
 * atomic replace/transaction; corrupt state is rejected rather than replaced. */
export class ProjectEnvironmentRepository {
	private current: ProjectEnvironmentState | undefined;
	constructor(private readonly backend: ProjectEnvironmentStateBackend, private readonly serverId: string, initialState?: ProjectEnvironmentState) {
		if (initialState !== undefined) this.current = canonicalizeProjectEnvironmentState(initialState, serverId);
	}

	async load(): Promise<ProjectEnvironmentState> {
		if (this.current !== undefined) return structuredClone(this.current);
		const raw = await this.backend.load();
		const state = raw === undefined ? createInitialProjectEnvironmentState(this.serverId) : migrateProjectEnvironmentState(raw, this.serverId);
		if (raw === undefined || (raw as { schemaVersion?: unknown }).schemaVersion !== PROJECT_ENVIRONMENT_SCHEMA_VERSION || projectEnvironmentRegistryHasUnknownCapabilities(raw) || projectEnvironmentRegistryHasOrphanedProfileRecords(raw)) await this.backend.commit(state);
		this.current = state;
		return structuredClone(state);
	}

	async commit(expectedRevision: number, update: (state: ProjectEnvironmentState) => ProjectEnvironmentState): Promise<ProjectEnvironmentState> {
		const before = this.current ?? await this.load();
		if (before.revision !== expectedRevision) throw new ProjectEnvironmentConflictError(before.revision);
		const proposed = update(structuredClone(before));
		const next = canonicalizeProjectEnvironmentState({ ...proposed, serverId: before.serverId, schemaVersion: before.schemaVersion, revision: before.revision + 1, cursor: String(before.revision + 1) }, before.serverId);
		if (this.backend.backup !== undefined) await this.backend.backup(before);
		await this.backend.commit(next);
		this.current = next;
		return structuredClone(next);
	}

	get state(): ProjectEnvironmentState { if (this.current === undefined) throw new Error('project environment repository is not loaded'); return structuredClone(this.current); }
}

export function migrateProjectEnvironmentState(input: unknown, serverId: string): ProjectEnvironmentState {
	if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new TypeError('project environment registry must be an object');
	const value = input as Record<string, unknown>;
	if (value.schemaVersion === PROJECT_ENVIRONMENT_SCHEMA_VERSION) return canonicalizeProjectEnvironmentState(dropOrphanedProfileRecords(value), serverId);
	if (value.schemaVersion !== 1 || typeof value.environments !== 'object' || value.environments === null) throw new TypeError('unsupported project environment registry schema');
	const environments = Object.fromEntries(Object.entries(value.environments as Record<string, Record<string, unknown>>).map(([id, environment]) => [id, { ...environment, providerState: null, providerRevision: 1 }]));
	return canonicalizeProjectEnvironmentState({ ...value, schemaVersion: PROJECT_ENVIRONMENT_SCHEMA_VERSION, environments, operations: {} }, serverId);
}

/** Recover only the known interrupted-local-removal shape. This is deliberately
 * not a generic corruption repair: malformed fields continue to fail loudly.
 * Dropping these local records never reaches a provider, so it cannot delete or
 * power off a remote VM that remains in the Puzed account. */
function dropOrphanedProfileRecords(input: Record<string, unknown>): Record<string, unknown> {
	if (!projectEnvironmentRegistryHasOrphanedProfileRecords(input)) return input;
	const profiles = input.profiles as Record<string, unknown>;
	const environments = input.environments as Record<string, unknown>;
	const orphanedEnvironmentIds = new Set(Object.entries(environments)
		.filter(([, environment]) => {
			if (typeof environment !== 'object' || environment === null || Array.isArray(environment)) return false;
			const profileId = (environment as Record<string, unknown>).profileId;
			return typeof profileId === 'string' && profiles[profileId] === undefined;
		})
		.map(([id]) => id));
	const operations = typeof input.operations === 'object' && input.operations !== null && !Array.isArray(input.operations)
		? input.operations as Record<string, unknown>
		: input.operations;
	return {
		...input,
		environments: Object.fromEntries(Object.entries(environments).filter(([id]) => !orphanedEnvironmentIds.has(id))),
		operations: typeof operations === 'object' && operations !== null && !Array.isArray(operations)
			? Object.fromEntries(Object.entries(operations).filter(([, operation]) => !(typeof operation === 'object' && operation !== null && !Array.isArray(operation) && orphanedEnvironmentIds.has((operation as Record<string, unknown>).environmentId as string))))
			: operations,
	};
}

export class ProjectEnvironmentConflictError extends Error {
	readonly code = 'conflict';
	constructor(readonly currentRevision: number) { super('project environment registry revision is stale'); this.name = 'ProjectEnvironmentConflictError'; }
}

export class FileProjectEnvironmentStateBackend implements ProjectEnvironmentStateBackend {
	constructor(private readonly filePath: string) { if (filePath.length === 0) throw new TypeError('project environment state path is required'); }
	async load(): Promise<unknown | undefined> { try { return JSON.parse(await readFile(this.filePath, 'utf8')) as unknown; } catch (error) { if ((error as { code?: string }).code === 'ENOENT') return undefined; throw error; } }
	async commit(state: ProjectEnvironmentState): Promise<void> { await mkdir(dirname(this.filePath), { recursive: true }); const temporary = `${this.filePath}.${randomUUID()}.tmp`; await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); await rename(temporary, this.filePath); }
}
