/**
 * Client-side projection of the server's published notifications.
 *
 * A client displays what the server's notification manager has published and
 * derives nothing from terminal activity. It applies only bounded snapshots and
 * ordered server events; a replay gap is surfaced as `resync_required` so the
 * host can fetch a fresh server snapshot.
 */

export type NotificationSource = "activity" | "message";
export type NotificationKind =
  | "agent-finished"
  | "agent-waiting"
  | "agent-blocked"
  | "command-finished"
  | "attention"
  | "message";

export interface NotificationRecord {
  readonly id: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly source: NotificationSource;
  readonly kind: NotificationKind;
  /** Present only on a notification a process sent. Plain text. */
  readonly title?: string;
  readonly body?: string;
  readonly raisedAt: number;
}

export interface NotificationSnapshot {
  readonly revision: number;
  readonly cursor: string;
  readonly notifications: Readonly<Record<string, NotificationRecord>>;
}

export interface NotificationEvent {
  readonly revision: number;
  readonly cursor: string;
  readonly type: "notification.published" | "notification.changed" | "notification.removed";
  readonly id: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly notification?: NotificationRecord;
}

export interface NotificationReplay {
  readonly kind: "events" | "resync";
  readonly events: readonly NotificationEvent[];
  readonly snapshot?: NotificationSnapshot;
}

export type NotificationApplyResult =
  | { readonly kind: "applied"; readonly revision: number; readonly changed: boolean }
  | { readonly kind: "ignored"; readonly revision: number; readonly changed: false }
  | { readonly kind: "resync_required"; readonly afterRevision: number; readonly receivedRevision: number };

export type NotificationSnapshotListener = (snapshot: NotificationSnapshot, result: NotificationApplyResult) => void;

const MAX_NOTIFICATIONS = 4096 * 9;
const MAX_TITLE_CHARS = 80;
const MAX_BODY_CHARS = 280;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const KINDS: readonly string[] = ["agent-finished", "agent-waiting", "agent-blocked", "command-finished", "attention", "message"];
const EVENT_TYPES: readonly string[] = ["notification.published", "notification.changed", "notification.removed"];

export class NotificationSnapshotStore {
  private readonly listeners = new Set<NotificationSnapshotListener>();
  private current: NotificationSnapshot = freezeSnapshot({ revision: 0, cursor: "0", notifications: {} });

  get snapshot(): NotificationSnapshot { return this.current; }
  get revision(): number { return this.current.revision; }
  get cursor(): string { return this.current.cursor; }

  subscribe(listener: NotificationSnapshotListener): () => void {
    if (typeof listener !== "function") throw new TypeError("notification listener must be a function");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Apply a newer snapshot. An older one is ignored. */
  applySnapshot(snapshot: NotificationSnapshot): NotificationApplyResult {
    const next = normalizeSnapshot(snapshot);
    if (next.revision < this.current.revision) return { kind: "ignored", revision: this.current.revision, changed: false };
    return this.replace(next);
  }

  /** Replace explicitly when reconnecting to a newly restarted server, whose
   * revision sequence may legitimately be lower. */
  reset(snapshot: NotificationSnapshot): NotificationApplyResult {
    return this.replace(normalizeSnapshot(snapshot));
  }

  applyReplay(replay: NotificationReplay): NotificationApplyResult {
    if (!replay || typeof replay !== "object") throw new TypeError("notification replay is invalid");
    if (replay.kind === "resync") {
      if (replay.snapshot === undefined) throw new TypeError("notification resync is missing a snapshot");
      return this.reset(replay.snapshot);
    }
    if (replay.kind !== "events" || !Array.isArray(replay.events)) throw new TypeError("notification replay is invalid");
    let result: NotificationApplyResult = { kind: "ignored", revision: this.current.revision, changed: false };
    for (const event of replay.events) {
      result = this.applyEvent(event);
      if (result.kind === "resync_required") return result;
    }
    return result;
  }

  applyEvent(event: NotificationEvent): NotificationApplyResult {
    validateRevision(event?.revision, event?.cursor);
    if (event.revision <= this.current.revision) return { kind: "ignored", revision: this.current.revision, changed: false };
    if (event.revision !== this.current.revision + 1) return { kind: "resync_required", afterRevision: this.current.revision, receivedRevision: event.revision };
    if (!EVENT_TYPES.includes(event.type)) throw new TypeError("notification event type is invalid");
    assertId(event.id, "notification id");

    const notifications: Record<string, NotificationRecord> = { ...this.current.notifications };
    let changed = false;
    if (event.type === "notification.removed") {
      if (notifications[event.id] !== undefined) {
        delete notifications[event.id];
        changed = true;
      }
    } else {
      if (event.notification === undefined) throw new TypeError("notification event is missing its notification");
      const normalized = normalizeRecord(event.notification);
      if (normalized.id !== event.id) throw new TypeError("notification event id mismatch");
      const existing = notifications[event.id];
      if (existing === undefined || JSON.stringify(existing) !== JSON.stringify(normalized)) {
        notifications[event.id] = normalized;
        changed = true;
      }
    }
    this.current = freezeSnapshot({ revision: event.revision, cursor: event.cursor, notifications });
    const result: NotificationApplyResult = changed
      ? { kind: "applied", revision: event.revision, changed: true }
      : { kind: "ignored", revision: event.revision, changed: false };
    if (changed) this.publish(result);
    return result;
  }

  private replace(next: NotificationSnapshot): NotificationApplyResult {
    if (next.revision === this.current.revision && JSON.stringify(next.notifications) === JSON.stringify(this.current.notifications)) {
      return { kind: "ignored", revision: this.current.revision, changed: false };
    }
    this.current = next;
    const result: NotificationApplyResult = { kind: "applied", revision: next.revision, changed: true };
    this.publish(result);
    return result;
  }

  private publish(result: NotificationApplyResult): void {
    for (const listener of this.listeners) {
      try { listener(this.current, result); } catch { /* observer failures cannot roll back state */ }
    }
  }
}

function normalizeSnapshot(snapshot: NotificationSnapshot): NotificationSnapshot {
  if (!snapshot || typeof snapshot !== "object" || !snapshot.notifications || typeof snapshot.notifications !== "object" || Array.isArray(snapshot.notifications)) {
    throw new TypeError("notification snapshot is invalid");
  }
  validateRevision(snapshot.revision, snapshot.cursor);
  const notifications: Record<string, NotificationRecord> = {};
  const entries = Object.entries(snapshot.notifications);
  if (entries.length > MAX_NOTIFICATIONS) throw new RangeError("notification snapshot exceeds its limit");
  for (const [key, value] of entries) {
    const normalized = normalizeRecord(value);
    if (key !== normalized.id) throw new TypeError("notification snapshot key mismatch");
    notifications[key] = normalized;
  }
  return freezeSnapshot({ revision: snapshot.revision, cursor: snapshot.cursor, notifications });
}

function normalizeRecord(value: NotificationRecord): NotificationRecord {
  if (!value || typeof value !== "object" || !ID_PATTERN.test(value.id) || !ID_PATTERN.test(value.projectId) || !ID_PATTERN.test(value.sessionId) || (value.source !== "activity" && value.source !== "message") || !KINDS.includes(value.kind) || (value.kind === "message") !== (value.source === "message") || !Number.isFinite(value.raisedAt) || !isText(value.title, MAX_TITLE_CHARS) || !isText(value.body, MAX_BODY_CHARS)) {
    throw new TypeError("notification is invalid");
  }
  // Only a notification a process sent carries text.
  const text = value.source === "message"
    ? { ...(value.title === undefined ? {} : { title: value.title }), ...(value.body === undefined ? {} : { body: value.body }) }
    : {};
  return Object.freeze({
    id: value.id,
    projectId: value.projectId,
    sessionId: value.sessionId,
    source: value.source,
    kind: value.kind,
    ...text,
    raisedAt: value.raisedAt,
  });
}

function isText(value: unknown, maxChars: number): boolean {
  return value === undefined || (typeof value === "string" && [...value].length <= maxChars);
}

function freezeSnapshot(value: { readonly revision: number; readonly cursor: string; readonly notifications: Readonly<Record<string, NotificationRecord>> }): NotificationSnapshot {
  return Object.freeze({ revision: value.revision, cursor: value.cursor, notifications: Object.freeze({ ...value.notifications }) });
}

function validateRevision(revision: unknown, cursor: unknown): asserts revision is number {
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0 || typeof cursor !== "string" || cursor !== String(revision)) throw new TypeError("notification revision is invalid");
}

function assertId(value: string, name: string): void {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new TypeError(`${name} is invalid`);
}
