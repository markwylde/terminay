import { constants, mkdirSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
	isStateUnreadableError,
	loadCanonicalState,
	type StateStoreName,
	writeFileDurably,
	writeFileDurablySync,
} from './durableFile.js';
import type { WorkspaceState } from './workspace.js';
import {
	migrateWorkspaceState,
	validateWorkspace,
	WORKSPACE_SCHEMA_VERSION,
	WorkspaceStore,
} from './workspace.js';

export interface WorkspaceStateBackend {
	load(): Promise<unknown | undefined>;
	commit(state: WorkspaceState): Promise<void>;
	/** Required by the canonical synchronous reducer transaction. File/SQLite
	 * production backends provide an atomic implementation. */
	commitSync?(state: WorkspaceState): void;
	backup?(state: WorkspaceState): Promise<void>;
	/** Keep what is stored now, untouched, before it is rewritten in a newer
	 * schema. Called at most once per load, and never replaces a copy an earlier
	 * upgrade from the same schema already kept. */
	preserveBeforeUpgrade?(fromSchemaVersion: number): Promise<void>;
}

export interface RepositoryConflict {
	readonly code: 'conflict';
	readonly currentRevision: number;
}
export type RepositoryCommitResult =
	| { readonly ok: true; readonly state: WorkspaceState }
	| { readonly ok: false; readonly conflict: RepositoryConflict };

export type WorkspacePersistenceFailureCode =
	| 'persistence_unreadable'
	| 'persistence_invalid'
	| 'persistence_uncommittable';

/** Safe startup/transaction failure. Backend paths, bytes, and platform error
 * details remain in the cause for privileged diagnostics and never enter the
 * renderer-facing message. */
export class WorkspacePersistenceError extends Error {
	readonly retryable: boolean;
	/** Set when the stored workspace is corrupt with no good previous copy
	 * (ADR-0088): the cause is a StateUnreadableError naming this store, and
	 * the host may offer to start it fresh as well as retry. */
	readonly store: StateStoreName | undefined;
	constructor(
		readonly code: WorkspacePersistenceFailureCode,
		options: { readonly cause?: unknown } = {},
	) {
		super(
			workspacePersistenceMessage(code),
			options.cause === undefined ? undefined : { cause: options.cause },
		);
		this.name = 'WorkspacePersistenceError';
		this.retryable = code !== 'persistence_invalid';
		this.store = isStateUnreadableError(options.cause)
			? options.cause.store
			: undefined;
	}
}

function workspacePersistenceMessage(
	code: WorkspacePersistenceFailureCode,
): string {
	if (code === 'persistence_unreadable')
		return 'The canonical workspace could not be read. Check the server data directory and retry.';
	if (code === 'persistence_invalid')
		return 'The canonical workspace is invalid. Restore its server-owned backup before retrying.';
	return 'The canonical workspace could not be saved. Check available storage and server data-directory permissions, then retry.';
}

/** Persistence boundary for canonical workspace state. The backend owns the
 * actual SQLite/file transaction; this layer owns schema migration, revision
 * checks, backup ordering, and never substitutes a default over corrupt data. */
export class WorkspaceRepository {
	private store: WorkspaceStore | undefined;
	private loaded = false;
	private created = false;
	private loading: Promise<WorkspaceState> | undefined;

	constructor(
		private readonly backend: WorkspaceStateBackend,
		private readonly serverId: string,
		private readonly initialState?: () => WorkspaceState,
	) {}

	async load(): Promise<WorkspaceState> {
		if (this.loaded && this.store !== undefined) return this.store.state;
		if (this.loading !== undefined) return this.loading;
		this.loading = this.loadOnce();
		try {
			return await this.loading;
		} finally {
			this.loading = undefined;
		}
	}

	private async loadOnce(): Promise<WorkspaceState> {
		let raw: unknown | undefined;
		try {
			raw = await this.backend.load();
		} catch (error) {
			throw persistenceFailure('persistence_unreadable', error);
		}
		this.created = raw === undefined;
		let state: WorkspaceState;
		try {
			state =
				raw === undefined
					? (this.initialState?.() ??
						migrateWorkspaceState(
							{ schemaVersion: 0, serverId: this.serverId, projects: {} },
							this.serverId,
						))
					: migrateWorkspaceState(raw, this.serverId);
			validateWorkspace(state);
		} catch (error) {
			throw persistenceFailure('persistence_invalid', error);
		}
		if (raw !== undefined) {
			const restored = new WorkspaceStore(state);
			state = restored.markInterruptedSessions();
		}
		// A fresh server must persist its canonical workspace immediately. An
		// empty renderer layout is not a recoverable source of truth, so after
		// this point reloads always have a server-owned snapshot to migrate from.
		const rawSchemaVersion =
			typeof raw === 'object' && raw !== null && !Array.isArray(raw)
				? (raw as Record<string, unknown>).schemaVersion
				: undefined;
		const recoveryChanged =
			raw !== undefined &&
			state.revision !== (raw as { revision?: unknown }).revision;
		if (
			raw === undefined ||
			rawSchemaVersion !== WORKSPACE_SCHEMA_VERSION ||
			recoveryChanged
		) {
			try {
				// An older build cannot read the upgraded file, so the stored one is
				// kept aside first; if that fails the upgrade is not written.
				if (
					typeof rawSchemaVersion === 'number' &&
					rawSchemaVersion !== WORKSPACE_SCHEMA_VERSION
				)
					await this.backend.preserveBeforeUpgrade?.(rawSchemaVersion);
				await this.backend.commit(state);
			} catch (error) {
				throw persistenceFailure('persistence_uncommittable', error);
			}
		}
		this.store = new WorkspaceStore(state, {
			...(this.backend.commitSync === undefined
				? {}
				: {
						commit: (next) => {
							try {
								this.backend.commitSync!(next);
							} catch (error) {
								throw persistenceFailure('persistence_uncommittable', error);
							}
						},
					}),
		});
		this.loaded = true;
		return this.store.state;
	}

	async apply(
		command: Parameters<WorkspaceStore['apply']>[0],
	): Promise<RepositoryCommitResult> {
		const store = this.store ?? new WorkspaceStore(await this.load());
		const before = store.state;
		// Async-only backends cannot participate in WorkspaceStore's synchronous
		// pre-publication hook. Reduce against an isolated candidate and publish
		// it only after the durable commit succeeds.
		const candidate =
			this.backend.commitSync === undefined
				? new WorkspaceStore(before)
				: store;
		const result = candidate.apply(command);
		if (!result.ok)
			return {
				ok: false,
				conflict: {
					code: 'conflict',
					currentRevision: result.conflict.currentRevision,
				},
			};
		try {
			if (this.backend.backup !== undefined) await this.backend.backup(before);
		} catch (error) {
			throw persistenceFailure('persistence_uncommittable', error);
		}
		// A synchronous transactional backend was invoked by WorkspaceStore before
		// it published the revision. Async-only repositories commit here.
		if (this.backend.commitSync === undefined) {
			try {
				await this.backend.commit(result.state);
			} catch (error) {
				throw persistenceFailure('persistence_uncommittable', error);
			}
		}
		this.store = candidate;
		return { ok: true, state: result.state };
	}

	get state(): WorkspaceState {
		if (this.store === undefined)
			throw new Error('workspace repository is not loaded');
		return this.store.state;
	}
	get workspace(): WorkspaceStore {
		if (this.store === undefined)
			throw new Error('workspace repository is not loaded');
		return this.store;
	}
	get wasCreated(): boolean {
		if (!this.loaded) throw new Error('workspace repository is not loaded');
		return this.created;
	}
}

function persistenceFailure(
	code: WorkspacePersistenceFailureCode,
	cause: unknown,
): WorkspacePersistenceError {
	return cause instanceof WorkspacePersistenceError
		? cause
		: new WorkspacePersistenceError(code, { cause });
}

/** A stored workspace is at least a JSON object. Its full shape, including
 * older schemas and Desktop's compatibility transform, is checked by the
 * repository after migration. */
function storedWorkspaceObject(value: unknown): unknown | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? value
		: undefined;
}

/** Durable JSON backend shared by embedded Desktop and standalone servers.
 * Every commit keeps the last good file as `.previous`; a corrupt file loads
 * that copy instead, or fails with StateUnreadableError('workspace') when
 * there is none (ADR-0088). */
export class FileWorkspaceStateBackend implements WorkspaceStateBackend {
	constructor(
		private readonly filePath: string,
		private readonly validate: (
			value: unknown,
		) => unknown | undefined = storedWorkspaceObject,
	) {
		if (filePath.length === 0)
			throw new TypeError('workspace state path is required');
	}
	async load(): Promise<unknown | undefined> {
		return loadCanonicalState(this.filePath, 'workspace', {
			validate: this.validate,
			mode: 0o600,
		});
	}
	async preserveBeforeUpgrade(fromSchemaVersion: number): Promise<void> {
		try {
			await copyFile(
				this.filePath,
				`${this.filePath}.schema-${fromSchemaVersion}.backup`,
				constants.COPYFILE_EXCL,
			);
		} catch (error) {
			if ((error as { code?: string }).code !== 'EEXIST') throw error;
		}
	}
	async commit(state: WorkspaceState): Promise<void> {
		await mkdir(dirname(this.filePath), { recursive: true });
		await writeFileDurably(
			this.filePath,
			`${JSON.stringify(state, null, 2)}\n`,
			{ mode: 0o600, keepPrevious: true },
		);
	}
	commitSync(state: WorkspaceState): void {
		mkdirSync(dirname(this.filePath), { recursive: true });
		writeFileDurablySync(this.filePath, `${JSON.stringify(state, null, 2)}\n`, {
			mode: 0o600,
			keepPrevious: true,
		});
	}
}
