/**
 * Client-side projection of the server-owned terminal activity stream.
 *
 * This adapter deliberately does not infer activity or mutate provider state.
 * It applies only bounded snapshots and ordered server events; a retained
 * replay gap is surfaced as `resync_required` so the host can fetch a fresh
 * server snapshot.
 */

export type ActivityStatus = "working" | "idle";
export type ActivityAuthority = "none" | "raw" | "structured" | "provider";

export interface ActivitySessionSnapshot {
  readonly sessionId: string;
  readonly projectId?: string;
  readonly foregroundBusy: boolean;
  readonly status: ActivityStatus;
  readonly attention: boolean;
  readonly acknowledged: boolean;
  readonly claimed: boolean;
  readonly authority: ActivityAuthority;
  readonly source: string;
  readonly exitCode?: number;
  readonly provider?: string;
  readonly providerState?: "working" | "waiting" | "blocked" | "done" | "idle";
  readonly agentId?: string;
  readonly updatedAt: number;
}

export interface ActivitySnapshot {
  readonly revision: number;
  readonly cursor: string;
  readonly sessions: Readonly<Record<string, ActivitySessionSnapshot>>;
}

export interface ActivityEvent {
  readonly revision: number;
  readonly cursor: string;
  readonly type: "activity.changed" | "activity.removed";
  readonly sessionId: string;
  readonly snapshot?: ActivitySessionSnapshot;
}

export interface ActivityReplay {
  readonly kind: "events" | "resync";
  readonly events: readonly ActivityEvent[];
  readonly snapshot?: ActivitySnapshot;
}

export type ActivityApplyResult =
  | { readonly kind: "applied"; readonly revision: number; readonly changed: boolean }
  | { readonly kind: "ignored"; readonly revision: number; readonly changed: false }
  | { readonly kind: "resync_required"; readonly afterRevision: number; readonly receivedRevision: number };

export interface ActivitySnapshotStoreOptions {
  /** Filter the projection to one server-owned project without retargeting. */
  readonly projectId?: string;
  readonly maxSessions?: number;
}

export type ActivitySnapshotListener = (snapshot: ActivitySnapshot, result: ActivityApplyResult) => void;

const DEFAULT_MAX_SESSIONS = 4096;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SOURCE_MAX_LENGTH = 128;

export class ActivitySnapshotStore {
  private readonly projectId: string | undefined;
  private readonly maxSessions: number;
  private readonly listeners = new Set<ActivitySnapshotListener>();
  private current: ActivitySnapshot = freezeSnapshot({ revision: 0, cursor: "0", sessions: {} });

  constructor(options: ActivitySnapshotStoreOptions = {}) {
    if (options.projectId !== undefined) assertId(options.projectId, "project id");
    this.projectId = options.projectId;
    this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
    if (!Number.isSafeInteger(this.maxSessions) || this.maxSessions <= 0) throw new RangeError("maxSessions must be positive");
  }

  get snapshot(): ActivitySnapshot { return this.current; }
  get revision(): number { return this.current.revision; }
  get cursor(): string { return this.current.cursor; }

  subscribe(listener: ActivitySnapshotListener): () => void {
    if (typeof listener !== "function") throw new TypeError("activity listener must be a function");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Replace the projection after a reconnect/resync response. */
  applySnapshot(snapshot: ActivitySnapshot): ActivityApplyResult {
    const next = this.normalizeSnapshot(snapshot);
    if (next.revision < this.current.revision) return { kind: "ignored", revision: this.current.revision, changed: false };
    if (next.revision === this.current.revision && next.cursor === this.current.cursor && sameSessions(next.sessions, this.current.sessions)) {
      return { kind: "ignored", revision: this.current.revision, changed: false };
    }
    this.current = next;
    const result: ActivityApplyResult = { kind: "applied", revision: next.revision, changed: true };
    this.publish(result);
    return result;
  }

  /** Reset explicitly when reconnecting to a newly restarted server. */
  reset(snapshot: ActivitySnapshot): ActivityApplyResult {
    const next = this.normalizeSnapshot(snapshot);
    if (next.revision === this.current.revision && next.cursor === this.current.cursor && sameSessions(next.sessions, this.current.sessions)) {
      return { kind: "ignored", revision: this.current.revision, changed: false };
    }
    this.current = next;
    const result: ActivityApplyResult = { kind: "applied", revision: next.revision, changed: true };
    this.publish(result);
    return result;
  }

  applyReplay(replay: ActivityReplay): ActivityApplyResult {
    if (!replay || typeof replay !== "object") throw new TypeError("activity replay is invalid");
    if (replay.kind === "resync") {
      if (replay.snapshot === undefined) throw new TypeError("activity resync is missing a snapshot");
      return this.applySnapshot(replay.snapshot);
    }
    if (replay.kind !== "events" || !Array.isArray(replay.events)) throw new TypeError("activity replay is invalid");
    let result: ActivityApplyResult = { kind: "ignored", revision: this.current.revision, changed: false };
    for (const event of replay.events) {
      result = this.applyEvent(event);
      if (result.kind === "resync_required") return result;
    }
    return result;
  }

  applyEvent(event: ActivityEvent): ActivityApplyResult {
    validateRevision(event?.revision, event?.cursor);
    if (event.revision <= this.current.revision) return { kind: "ignored", revision: this.current.revision, changed: false };
    if (event.revision !== this.current.revision + 1) return { kind: "resync_required", afterRevision: this.current.revision, receivedRevision: event.revision };
    if (event.type !== "activity.changed" && event.type !== "activity.removed") throw new TypeError("activity event type is invalid");
    assertId(event.sessionId, "session id");

    const sessions: Record<string, ActivitySessionSnapshot> = { ...this.current.sessions };
    let changed = false;
    if (event.type === "activity.changed") {
      if (event.snapshot === undefined) throw new TypeError("activity changed event is missing a snapshot");
      const normalized = this.normalizeSession(event.snapshot);
      const visible = this.projectId === undefined || normalized.projectId === this.projectId;
      const existing = sessions[event.sessionId];
      // A session id is immutable. A cross-project event advances the global
      // cursor but cannot retarget a visible session in this projection.
      if (normalized.sessionId !== event.sessionId) throw new TypeError("activity event session mismatch");
      if (visible && (existing === undefined || existing.projectId === normalized.projectId)) {
        if (existing === undefined || JSON.stringify(existing) !== JSON.stringify(normalized)) {
          sessions[event.sessionId] = normalized;
          changed = true;
        }
      }
    } else if (sessions[event.sessionId] !== undefined) {
      delete sessions[event.sessionId];
      changed = true;
    }
    this.current = freezeSnapshot({ revision: event.revision, cursor: event.cursor, sessions });
    const result: ActivityApplyResult = changed
      ? { kind: "applied", revision: event.revision, changed: true }
      : { kind: "ignored", revision: event.revision, changed: false };
    if (changed) this.publish(result);
    return result;
  }

  private normalizeSnapshot(snapshot: ActivitySnapshot): ActivitySnapshot {
    if (!snapshot || typeof snapshot !== "object" || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0 || typeof snapshot.cursor !== "string" || snapshot.cursor !== String(snapshot.revision) || !snapshot.sessions || typeof snapshot.sessions !== "object" || Array.isArray(snapshot.sessions)) {
      throw new TypeError("activity snapshot is invalid");
    }
    const sessions: Record<string, ActivitySessionSnapshot> = {};
    for (const [key, value] of Object.entries(snapshot.sessions)) {
      if (Object.keys(sessions).length >= this.maxSessions) throw new RangeError("activity snapshot exceeds session limit");
      const normalized = this.normalizeSession(value);
      if (key !== normalized.sessionId) throw new TypeError("activity snapshot session key mismatch");
      if (this.projectId === undefined || normalized.projectId === this.projectId) sessions[key] = normalized;
    }
    return freezeSnapshot({ revision: snapshot.revision, cursor: snapshot.cursor, sessions });
  }

  private normalizeSession(value: ActivitySessionSnapshot): ActivitySessionSnapshot {
    if (!value || typeof value !== "object" || !ID_PATTERN.test(value.sessionId) || (value.projectId !== undefined && !ID_PATTERN.test(value.projectId)) || (value.foregroundBusy !== undefined && typeof value.foregroundBusy !== "boolean") || (value.status !== "working" && value.status !== "idle") || typeof value.attention !== "boolean" || typeof value.acknowledged !== "boolean" || typeof value.claimed !== "boolean" || !["none", "raw", "structured", "provider"].includes(value.authority) || typeof value.source !== "string" || value.source.length > SOURCE_MAX_LENGTH || !Number.isFinite(value.updatedAt)) throw new TypeError("activity session snapshot is invalid");
    return Object.freeze({ ...value, foregroundBusy: value.foregroundBusy ?? false });
  }

  private publish(result: ActivityApplyResult): void {
    for (const listener of this.listeners) {
      try { listener(this.current, result); } catch { /* observer failures cannot roll back state */ }
    }
  }
}

function freezeSnapshot(value: { readonly revision: number; readonly cursor: string; readonly sessions: Readonly<Record<string, ActivitySessionSnapshot>> }): ActivitySnapshot {
  return Object.freeze({ revision: value.revision, cursor: value.cursor, sessions: Object.freeze({ ...value.sessions }) });
}

function validateRevision(revision: unknown, cursor: unknown): asserts revision is number {
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0 || typeof cursor !== "string" || cursor !== String(revision)) throw new TypeError("activity event revision is invalid");
}

function assertId(value: string, name: string): void {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new TypeError(`${name} is invalid`);
}

function sameSessions(a: Readonly<Record<string, ActivitySessionSnapshot>>, b: Readonly<Record<string, ActivitySessionSnapshot>>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
