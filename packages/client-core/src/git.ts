/** Bounded client projection of server-owned Git progress/status events. */

export type GitDiscoveryState = "ready" | "not-repository" | "git-unavailable" | "missing-gitfile" | "command-error";
export type GitProgressPhase = "started" | "completed" | "failed";
export type GitOperation = "status" | "branch" | "diff" | "worktrees" | "worktree.remove" | "quick-push";

export interface GitProgressEvent {
  readonly revision: number;
  readonly cursor: string;
  readonly type: "git.progress";
  readonly operation: GitOperation;
  readonly phase: GitProgressPhase;
  readonly projectId: string;
  readonly repositoryId: string | null;
  readonly worktreeId: string | null;
  readonly state: GitDiscoveryState | "removed";
  readonly bounded: boolean;
}

export interface GitStatusChangeEvent {
  readonly revision: number;
  readonly cursor: string;
  readonly type: "git.status.changed";
  readonly projectId: string;
  readonly repositoryId: string | null;
  readonly worktreeId: string | null;
  readonly state: GitDiscoveryState;
  readonly branch: string | null;
  readonly head: string | null;
  readonly changedFiles: number;
  readonly bounded: boolean;
}

export type GitServiceEvent = GitProgressEvent | GitStatusChangeEvent;
export type GitApplyResult =
  | { readonly kind: "applied"; readonly revision: number; readonly changed: boolean }
  | { readonly kind: "ignored"; readonly revision: number; readonly changed: false }
  | { readonly kind: "resync_required"; readonly afterRevision: number; readonly receivedRevision: number };

export interface GitStatusProjection extends GitStatusChangeEvent {
  readonly type: "git.status.changed";
}

export interface GitProgressProjection extends GitProgressEvent {
  readonly type: "git.progress";
}

export interface GitStatusStoreSnapshot {
  readonly revision: number;
  readonly cursor: string;
  readonly statuses: Readonly<Record<string, GitStatusProjection>>;
  readonly progress?: GitProgressProjection;
}

export interface GitStatusStoreOptions { readonly projectId?: string; readonly maxProjects?: number; }
export type GitStatusStoreListener = (snapshot: GitStatusStoreSnapshot, result: GitApplyResult) => void;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DEFAULT_MAX_PROJECTS = 1024;

export class GitStatusEventStore {
  private readonly projectId: string | undefined;
  private readonly maxProjects: number;
  private readonly listeners = new Set<GitStatusStoreListener>();
  private current: GitStatusStoreSnapshot = freezeSnapshot({ revision: 0, cursor: "0", statuses: {} });

  constructor(options: GitStatusStoreOptions = {}) {
    if (options.projectId !== undefined) assertId(options.projectId, "project id");
    this.projectId = options.projectId;
    this.maxProjects = options.maxProjects ?? DEFAULT_MAX_PROJECTS;
    if (!Number.isSafeInteger(this.maxProjects) || this.maxProjects <= 0) throw new RangeError("maxProjects must be positive");
  }

  get snapshot(): GitStatusStoreSnapshot { return this.current; }
  get revision(): number { return this.current.revision; }
  subscribe(listener: GitStatusStoreListener): () => void {
    if (typeof listener !== "function") throw new TypeError("Git status listener must be a function");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  applyEvents(events: readonly GitServiceEvent[]): GitApplyResult {
    if (!Array.isArray(events)) throw new TypeError("Git event replay is invalid");
    let result: GitApplyResult = { kind: "ignored", revision: this.revision, changed: false };
    for (const event of events) {
      result = this.applyEvent(event);
      if (result.kind === "resync_required") return result;
    }
    return result;
  }

  applyEvent(event: GitServiceEvent): GitApplyResult {
    validateRevision(event?.revision, event?.cursor);
    if (event.revision <= this.current.revision) return { kind: "ignored", revision: this.current.revision, changed: false };
    if (event.revision !== this.current.revision + 1) return { kind: "resync_required", afterRevision: this.current.revision, receivedRevision: event.revision };
    if (event.type !== "git.progress" && event.type !== "git.status.changed") throw new TypeError("Git event type is invalid");
    assertId(event.projectId, "project id");
    const visible = this.projectId === undefined || this.projectId === event.projectId;
    let changed = false;
    let statuses = this.current.statuses;
    let progress = this.current.progress;
    if (event.type === "git.status.changed") {
      validateStatusEvent(event);
      if (visible) {
        const key = statusKey(event.projectId, event.repositoryId, event.worktreeId);
        const previous = this.current.statuses[key];
        if (previous === undefined || JSON.stringify(previous) !== JSON.stringify(event)) {
          const next = { ...this.current.statuses, [key]: Object.freeze({ ...event }) };
          if (Object.keys(next).length > this.maxProjects) throw new RangeError("Git status projection exceeds project limit");
          statuses = next;
          changed = true;
        }
      }
    } else {
      validateProgressEvent(event);
      if (visible && (progress === undefined || JSON.stringify(progress) !== JSON.stringify(event))) {
        progress = Object.freeze({ ...event });
        changed = true;
      }
    }
    this.current = freezeSnapshot({ revision: event.revision, cursor: event.cursor, statuses, ...(progress === undefined ? {} : { progress }) });
    const result: GitApplyResult = changed ? { kind: "applied", revision: event.revision, changed: true } : { kind: "ignored", revision: event.revision, changed: false };
    if (changed) this.publish(result);
    return result;
  }

  reset(revision = 0): void {
    if (!Number.isSafeInteger(revision) || revision < 0) throw new RangeError("Git reset revision is invalid");
    this.current = freezeSnapshot({ revision, cursor: String(revision), statuses: {} });
  }

  private publish(result: GitApplyResult): void {
    for (const listener of this.listeners) {
      try { listener(this.current, result); } catch { /* observer failures cannot roll back state */ }
    }
  }
}

function freezeSnapshot(value: { readonly revision: number; readonly cursor: string; readonly statuses: Readonly<Record<string, GitStatusProjection>>; readonly progress?: GitProgressProjection }): GitStatusStoreSnapshot {
  return Object.freeze({ revision: value.revision, cursor: value.cursor, statuses: Object.freeze({ ...value.statuses }), ...(value.progress === undefined ? {} : { progress: value.progress }) });
}

function validateRevision(revision: unknown, cursor: unknown): asserts revision is number {
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0 || typeof cursor !== "string" || cursor !== String(revision)) throw new TypeError("Git event revision is invalid");
}

function validateStatusEvent(event: GitStatusChangeEvent): void {
  if ((event.repositoryId !== null && !ID_PATTERN.test(event.repositoryId)) || (event.worktreeId !== null && !ID_PATTERN.test(event.worktreeId)) || !["ready", "not-repository", "git-unavailable", "missing-gitfile", "command-error"].includes(event.state) || (event.branch !== null && event.branch.length > 256) || (event.head !== null && event.head.length > 256) || !Number.isSafeInteger(event.changedFiles) || event.changedFiles < 0 || typeof event.bounded !== "boolean") throw new TypeError("Git status event is invalid");
}

function validateProgressEvent(event: GitProgressEvent): void {
  if (![
    "status", "branch", "diff", "worktrees", "worktree.remove", "quick-push",
  ].includes(event.operation) || !["started", "completed", "failed"].includes(event.phase) || (event.repositoryId !== null && !ID_PATTERN.test(event.repositoryId)) || (event.worktreeId !== null && !ID_PATTERN.test(event.worktreeId)) || !["ready", "not-repository", "git-unavailable", "missing-gitfile", "command-error", "removed"].includes(event.state) || typeof event.bounded !== "boolean") throw new TypeError("Git progress event is invalid");
}

function statusKey(projectId: string, repositoryId: string | null, worktreeId: string | null): string { return `${projectId}\0${repositoryId ?? ""}\0${worktreeId ?? ""}`; }
function assertId(value: string, name: string): void { if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new TypeError(`${name} is invalid`); }
