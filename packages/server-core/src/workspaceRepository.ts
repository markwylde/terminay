import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { WorkspaceState } from "./workspace.js";
import { migrateWorkspaceState, validateWorkspace, WorkspaceStore, WORKSPACE_SCHEMA_VERSION } from "./workspace.js";

export interface WorkspaceStateBackend {
  load(): Promise<unknown | undefined>;
  commit(state: WorkspaceState): Promise<void>;
  /** Required by the canonical synchronous reducer transaction. File/SQLite
   * production backends provide an atomic implementation. */
  commitSync?(state: WorkspaceState): void;
  backup?(state: WorkspaceState): Promise<void>;
}

export interface RepositoryConflict { readonly code: "conflict"; readonly currentRevision: number; }
export type RepositoryCommitResult = { readonly ok: true; readonly state: WorkspaceState } | { readonly ok: false; readonly conflict: RepositoryConflict };

export type WorkspacePersistenceFailureCode =
  | "persistence_unreadable"
  | "persistence_invalid"
  | "persistence_uncommittable";

/** Safe startup/transaction failure. Backend paths, bytes, and platform error
 * details remain in the cause for privileged diagnostics and never enter the
 * renderer-facing message. */
export class WorkspacePersistenceError extends Error {
  readonly retryable: boolean;
  constructor(readonly code: WorkspacePersistenceFailureCode, options: { readonly cause?: unknown } = {}) {
    super(workspacePersistenceMessage(code), options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "WorkspacePersistenceError";
    this.retryable = code !== "persistence_invalid";
  }
}

function workspacePersistenceMessage(code: WorkspacePersistenceFailureCode): string {
  if (code === "persistence_unreadable") return "The canonical workspace could not be read. Check the server data directory and retry.";
  if (code === "persistence_invalid") return "The canonical workspace is invalid. Restore its server-owned backup before retrying.";
  return "The canonical workspace could not be saved. Check available storage and server data-directory permissions, then retry.";
}

/** Persistence boundary for canonical workspace state. The backend owns the
 * actual SQLite/file transaction; this layer owns schema migration, revision
 * checks, backup ordering, and never substitutes a default over corrupt data. */
export class WorkspaceRepository {
  private store: WorkspaceStore | undefined;
  private loaded = false;
  private created = false;
  private loading: Promise<WorkspaceState> | undefined;

  constructor(private readonly backend: WorkspaceStateBackend, private readonly serverId: string, private readonly initialState?: () => WorkspaceState) {}

  async load(): Promise<WorkspaceState> {
    if (this.loaded && this.store !== undefined) return this.store.state;
    if (this.loading !== undefined) return this.loading;
    this.loading = this.loadOnce();
    try { return await this.loading; }
    finally { this.loading = undefined; }
  }

  private async loadOnce(): Promise<WorkspaceState> {
    let raw: unknown | undefined;
    try { raw = await this.backend.load(); }
    catch (error) { throw persistenceFailure("persistence_unreadable", error); }
    this.created = raw === undefined;
    let state: WorkspaceState;
    try {
      state = raw === undefined
        ? (this.initialState?.() ?? migrateWorkspaceState({ schemaVersion: 0, serverId: this.serverId, projects: {} }, this.serverId))
        : migrateWorkspaceState(raw, this.serverId);
      validateWorkspace(state);
    } catch (error) { throw persistenceFailure("persistence_invalid", error); }
    if (raw !== undefined) {
      const restored = new WorkspaceStore(state);
      state = restored.markInterruptedSessions();
    }
    // A fresh server must persist its canonical workspace immediately. An
    // empty renderer layout is not a recoverable source of truth, so after
    // this point reloads always have a server-owned snapshot to migrate from.
    const rawSchemaVersion = typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).schemaVersion
      : undefined;
    const recoveryChanged = raw !== undefined && state.revision !== (raw as { revision?: unknown }).revision;
    if (raw === undefined || rawSchemaVersion !== WORKSPACE_SCHEMA_VERSION || recoveryChanged) {
      try { await this.backend.commit(state); }
      catch (error) { throw persistenceFailure("persistence_uncommittable", error); }
    }
    this.store = new WorkspaceStore(state, {
      ...(this.backend.commitSync === undefined ? {} : { commit: (next) => {
        try { this.backend.commitSync!(next); }
        catch (error) { throw persistenceFailure("persistence_uncommittable", error); }
      } }),
    });
    this.loaded = true; return this.store.state;
  }

  async apply(command: Parameters<WorkspaceStore["apply"]>[0]): Promise<RepositoryCommitResult> {
    const store = this.store ?? new WorkspaceStore(await this.load());
    const before = store.state;
    // Async-only backends cannot participate in WorkspaceStore's synchronous
    // pre-publication hook. Reduce against an isolated candidate and publish
    // it only after the durable commit succeeds.
    const candidate = this.backend.commitSync === undefined ? new WorkspaceStore(before) : store;
    const result = candidate.apply(command);
    if (!result.ok) return { ok: false, conflict: { code: "conflict", currentRevision: result.conflict.currentRevision } };
    try { if (this.backend.backup !== undefined) await this.backend.backup(before); }
    catch (error) { throw persistenceFailure("persistence_uncommittable", error); }
    // A synchronous transactional backend was invoked by WorkspaceStore before
    // it published the revision. Async-only repositories commit here.
    if (this.backend.commitSync === undefined) {
      try { await this.backend.commit(result.state); }
      catch (error) { throw persistenceFailure("persistence_uncommittable", error); }
    }
    this.store = candidate; return { ok: true, state: result.state };
  }

  get state(): WorkspaceState { if (this.store === undefined) throw new Error("workspace repository is not loaded"); return this.store.state; }
  get workspace(): WorkspaceStore { if (this.store === undefined) throw new Error("workspace repository is not loaded"); return this.store; }
  get wasCreated(): boolean { if (!this.loaded) throw new Error("workspace repository is not loaded"); return this.created; }
}

function persistenceFailure(code: WorkspacePersistenceFailureCode, cause: unknown): WorkspacePersistenceError {
  return cause instanceof WorkspacePersistenceError ? cause : new WorkspacePersistenceError(code, { cause });
}

/** Atomic JSON backend shared by embedded Desktop and standalone servers. */
export class FileWorkspaceStateBackend implements WorkspaceStateBackend {
  constructor(private readonly filePath: string) {
    if (filePath.length === 0) throw new TypeError("workspace state path is required");
  }
  async load(): Promise<unknown | undefined> {
    try { return JSON.parse(await readFile(this.filePath, "utf8")) as unknown; }
    catch (error) { if ((error as { code?: string }).code === "ENOENT") return undefined; throw error; }
  }
  async commit(state: WorkspaceState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await rename(temporary, this.filePath);
  }
  commitSync(state: WorkspaceState): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    renameSync(temporary, this.filePath);
  }
}
