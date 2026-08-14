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
    const raw = await this.backend.load();
    this.created = raw === undefined;
    let state = raw === undefined
      ? (this.initialState?.() ?? migrateWorkspaceState({ schemaVersion: 0, serverId: this.serverId, projects: {} }, this.serverId))
      : migrateWorkspaceState(raw, this.serverId);
    validateWorkspace(state);
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
    if (raw === undefined || rawSchemaVersion !== WORKSPACE_SCHEMA_VERSION || recoveryChanged) await this.backend.commit(state);
    this.store = new WorkspaceStore(state, {
      ...(this.backend.commitSync === undefined ? {} : { commit: (next) => this.backend.commitSync!(next) }),
    });
    this.loaded = true; return this.store.state;
  }

  async apply(command: Parameters<WorkspaceStore["apply"]>[0]): Promise<RepositoryCommitResult> {
    const store = this.store ?? new WorkspaceStore(await this.load());
    const before = store.state; const result = store.apply(command);
    if (!result.ok) return { ok: false, conflict: { code: "conflict", currentRevision: result.conflict.currentRevision } };
    if (this.backend.backup !== undefined) await this.backend.backup(before);
    // A synchronous transactional backend was invoked by WorkspaceStore before
    // it published the revision. Async-only repositories commit here.
    if (this.backend.commitSync === undefined) await this.backend.commit(result.state);
    this.store = store; return { ok: true, state: result.state };
  }

  get state(): WorkspaceState { if (this.store === undefined) throw new Error("workspace repository is not loaded"); return this.store.state; }
  get workspace(): WorkspaceStore { if (this.store === undefined) throw new Error("workspace repository is not loaded"); return this.store; }
  get wasCreated(): boolean { if (!this.loaded) throw new Error("workspace repository is not loaded"); return this.created; }
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
