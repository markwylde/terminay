import type { WorkspaceState } from "./workspace.js";
import { migrateWorkspaceState, validateWorkspace, WorkspaceStore } from "./workspace.js";

export interface WorkspaceStateBackend {
  load(): Promise<unknown | undefined>;
  commit(state: WorkspaceState): Promise<void>;
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

  constructor(private readonly backend: WorkspaceStateBackend, private readonly serverId: string) {}

  async load(): Promise<WorkspaceState> {
    if (this.loaded && this.store !== undefined) return this.store.state;
    const raw = await this.backend.load();
    const state = raw === undefined ? migrateWorkspaceState({ schemaVersion: 0, serverId: this.serverId, projects: {} }, this.serverId) : migrateWorkspaceState(raw, this.serverId);
    validateWorkspace(state); this.store = new WorkspaceStore(state); this.loaded = true; return this.store.state;
  }

  async apply(command: Parameters<WorkspaceStore["apply"]>[0]): Promise<RepositoryCommitResult> {
    const store = this.store ?? new WorkspaceStore(await this.load());
    const before = store.state; const result = store.apply(command);
    if (!result.ok) return { ok: false, conflict: { code: "conflict", currentRevision: result.conflict.currentRevision } };
    if (this.backend.backup !== undefined) await this.backend.backup(before);
    await this.backend.commit(result.state); this.store = store; return { ok: true, state: result.state };
  }

  get state(): WorkspaceState { if (this.store === undefined) throw new Error("workspace repository is not loaded"); return this.store.state; }
}
