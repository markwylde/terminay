import type { QueryCommandTransport } from "./queryCommand.js";

/**
 * Client projection for server-owned agent status. The client may filter a
 * snapshot to the sessions currently belonging to a project, but it never
 * reduces native provider events or changes operational state locally.
 */

export type AgentClientState = "working" | "waiting" | "blocked" | "done" | "idle";

export interface AgentClientEntry {
  readonly entryId: string;
  readonly kind: "root" | "subagent";
  readonly provider: "codex" | "claude-code";
  readonly agentId: string;
  readonly sessionId: string;
  readonly activationTerminalSessionId: string;
  readonly state: AgentClientState;
  readonly active: boolean;
  readonly unread: boolean;
  readonly [key: string]: unknown;
}

export interface AgentClientSnapshot {
  readonly revision: number;
  readonly cursor: string;
  readonly entries: Readonly<Record<string, AgentClientEntry>>;
}

export interface AgentClientEvent {
  readonly revision: number;
  readonly cursor: string;
  readonly type: "agent.changed" | "agent.removed";
  readonly entryId: string;
  readonly entry?: AgentClientEntry;
}

export type AgentClientApplyResult =
  | { readonly kind: "applied"; readonly revision: number; readonly changed: boolean }
  | { readonly kind: "ignored"; readonly revision: number; readonly changed: false }
  | { readonly kind: "resync_required"; readonly afterRevision: number; readonly receivedRevision: number };

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:%-]{0,4095}$/u;

/** Protocol names deliberately live at the client boundary so shared UI does
 * not import server-core just to use a host-neutral TerminayClient facade. */
export const AGENT_STATUS_OPERATIONS = Object.freeze({
  snapshot: "agent.snapshot",
  acknowledge: "agent.acknowledge",
  event: "agent",
} as const);

export interface AgentStatusClientTransport extends QueryCommandTransport {
  /** Agent state is live, server-owned state. A query/command-only bridge
   * cannot safely project it because it could leave a stale renderer snapshot
   * looking authoritative after the server changes. */
  subscribe: (event: string, listener: (snapshot: AgentClientSnapshot) => void) => (() => void) | Promise<(() => void)>;
}

export class AgentStatusClient {
  private current: AgentClientSnapshot = freezeSnapshot({ revision: 0, cursor: "0", entries: {} });
  private sourceEntries: Readonly<Record<string, AgentClientEntry>> = Object.freeze({});
  private readonly sessions = new Set<string>();
  private readonly listeners = new Set<(snapshot: AgentClientSnapshot) => void>();
  private unsubscribe: (() => void) | undefined;

  constructor(
    sessionIds: readonly string[] = [],
    private readonly transport?: AgentStatusClientTransport,
  ) {
    if (transport !== undefined && typeof transport.subscribe !== "function") {
      throw new Error("agent status subscriptions are required on this transport");
    }
    this.setSessionScope(sessionIds);
  }
  get snapshot(): AgentClientSnapshot { return this.current; }

  /** Fetch the complete reduced server snapshot. No provider hook payload or
   * credential is part of this response. */
  async refresh(): Promise<AgentClientApplyResult> {
    if (this.transport === undefined) throw new Error("agent status transport is unavailable");
    const snapshot = await this.transport.query(AGENT_STATUS_OPERATIONS.snapshot) as unknown as AgentClientSnapshot;
    return this.applySnapshot(snapshot);
  }

  /**
   * Replace this client projection from an authoritative server snapshot.
   *
   * This is deliberately separate from refresh(): refresh fences delayed
   * responses from the current server, whereas reload is for reconnecting
   * after a server restart or a client transport replacement where the
   * server's revision may legitimately restart at zero. It applies only the
   * supplied server projection; it never manufactures provider transitions.
   */
  async reload(): Promise<AgentClientApplyResult> {
    return this.resync();
  }

  /**
   * Replace the projection at an explicit reconnect/resync boundary. This
   * deliberately preserves the canonical snapshot's exact revision, cursor,
   * and immutable entry identities even when the server restarted.
   */
  async resync(): Promise<AgentClientApplyResult> {
    if (this.transport === undefined) throw new Error("agent status transport is unavailable");
    const snapshot = await this.transport.query(AGENT_STATUS_OPERATIONS.snapshot) as unknown as AgentClientSnapshot;
    return this.reset(snapshot);
  }

  /** Acknowledge only the immutable server project/session identity selected
   * by the user. The server remains the sole authority for unread state. */
  async acknowledge(identity: { readonly projectId: string; readonly sessionId: string; readonly entryId?: string }): Promise<void> {
    if (this.transport === undefined) throw new Error("agent status transport is unavailable");
    await this.transport.command(AGENT_STATUS_OPERATIONS.acknowledge, identity);
  }

  /** Subscribe to ordered, reduced server snapshots. The event payload is a
   * full snapshot, which means a client can safely recover from an event gap
   * without locally reducing provider events. */
  async subscribe(): Promise<() => void> {
    if (this.unsubscribe !== undefined) return this.unsubscribe;
    if (this.transport === undefined) throw new Error("agent status transport is unavailable");
    const unsubscribe = await this.transport.subscribe(AGENT_STATUS_OPERATIONS.event, (snapshot) => {
      this.applySnapshot(snapshot);
    });
    this.unsubscribe = () => {
      try { unsubscribe(); } catch { /* expected disconnect cleanup is local */ }
      this.unsubscribe = undefined;
    };
    // A bounded journal can resync while subscription activation is in
    // flight. The listener is now live, so refresh converges to the
    // authoritative snapshot without a replay window.
    try {
      await this.refresh();
    } catch (error) {
      this.unsubscribe?.();
      throw error;
    }
    return this.unsubscribe;
  }

  close(): void { this.unsubscribe?.(); }

  setSessionScope(sessionIds: readonly string[]): void {
    this.sessions.clear();
    for (const sessionId of sessionIds) if (ID_PATTERN.test(sessionId)) this.sessions.add(sessionId);
    this.publishScopedEntries();
  }

  /** Extend, rather than replace, a presentation scope with sessions already
   * rendered by this client. Workspace deltas can legitimately arrive before
   * a host-created terminal is represented in the workspace projection; that
   * ordering must not make a valid server-owned agent disappear from the UI.
   * This is only a local display filter: server authorization remains the
   * authority for every snapshot and command. */
  mergeSessionScope(sessionIds: readonly string[]): void {
    for (const sessionId of sessionIds) if (ID_PATTERN.test(sessionId)) this.sessions.add(sessionId);
    this.publishScopedEntries();
  }

  private publishScopedEntries(): void {
    const entries = this.projectEntries(this.sourceEntries);
    if (sameEntryProjection(this.current.entries, entries)) return;
    this.current = freezeSnapshot({ revision: this.current.revision, cursor: this.current.cursor, entries });
    this.publish();
  }

  onChange(listener: (snapshot: AgentClientSnapshot) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  applySnapshot(snapshot: AgentClientSnapshot): AgentClientApplyResult {
    const source = this.normalizeSnapshot(snapshot);
    if (snapshot.revision < this.current.revision) {
      return { kind: "ignored", revision: this.current.revision, changed: false };
    }
    this.sourceEntries = Object.freeze({ ...source });
    const normalized = freezeSnapshot({ revision: snapshot.revision, cursor: snapshot.cursor, entries: this.projectEntries(source) });
    if (snapshot.revision === this.current.revision && snapshot.cursor === this.current.cursor && sameEntryProjection(this.current.entries, normalized.entries)) {
      return { kind: "ignored", revision: this.current.revision, changed: false };
    }
    this.current = normalized;
    this.publish();
    return { kind: "applied", revision: normalized.revision, changed: true };
  }

  /** Apply an authoritative reload snapshot even if its revision restarted. */
  reset(snapshot: AgentClientSnapshot): AgentClientApplyResult {
    const source = this.normalizeSnapshot(snapshot);
    const normalized = freezeSnapshot({ revision: snapshot.revision, cursor: snapshot.cursor, entries: this.projectEntries(source) });
    if (snapshot.revision === this.current.revision && snapshot.cursor === this.current.cursor && sameEntryProjection(this.current.entries, normalized.entries)) {
      return { kind: "ignored", revision: this.current.revision, changed: false };
    }
    this.sourceEntries = Object.freeze({ ...source });
    this.current = normalized;
    this.publish();
    return { kind: "applied", revision: normalized.revision, changed: true };
  }

  applyEvent(event: AgentClientEvent): AgentClientApplyResult {
    validateRevision(event.revision, event.cursor);
    if (event.revision <= this.current.revision) return { kind: "ignored", revision: this.current.revision, changed: false };
    if (event.revision !== this.current.revision + 1) return { kind: "resync_required", afterRevision: this.current.revision, receivedRevision: event.revision };
    if (!ID_PATTERN.test(event.entryId)) throw new TypeError("agent entry id is invalid");
    const sourceEntries = { ...this.sourceEntries };
    if (event.type === "agent.changed") {
      if (event.entry === undefined) throw new TypeError("agent changed event is missing its entry");
      if (event.entry.entryId !== event.entryId) throw new TypeError("agent event entry mismatch");
      sourceEntries[event.entryId] = this.normalizeEntry(event.entry);
    } else {
      delete sourceEntries[event.entryId];
    }
    this.sourceEntries = Object.freeze(sourceEntries);
    const entries = this.projectEntries(sourceEntries);
    const changed = !sameEntryProjection(this.current.entries, entries);
    this.current = freezeSnapshot({ revision: event.revision, cursor: event.cursor, entries });
    if (changed) this.publish();
    return changed ? { kind: "applied", revision: event.revision, changed: true } : { kind: "ignored", revision: event.revision, changed: false };
  }

  entriesForSession(sessionId: string): readonly AgentClientEntry[] {
    return Object.values(this.current.entries).filter((entry) => entry.activationTerminalSessionId === sessionId);
  }

  private normalizeSnapshot(snapshot: AgentClientSnapshot): Readonly<Record<string, AgentClientEntry>> {
    if (!snapshot || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0 || snapshot.cursor !== String(snapshot.revision) || !snapshot.entries || typeof snapshot.entries !== "object" || Array.isArray(snapshot.entries)) throw new TypeError("agent snapshot is invalid");
    const entries: Record<string, AgentClientEntry> = {};
    for (const [entryId, value] of Object.entries(snapshot.entries)) {
      const entry = this.normalizeEntry(value);
      if (entryId !== entry.entryId) throw new TypeError("agent snapshot entry key mismatch");
      entries[entryId] = entry;
    }
    return Object.freeze(entries);
  }

  private normalizeEntry(value: AgentClientEntry): AgentClientEntry {
    if (!value || typeof value !== "object" || !ID_PATTERN.test(value.entryId) || !ID_PATTERN.test(value.sessionId) || !ID_PATTERN.test(value.activationTerminalSessionId) || (value.provider !== "codex" && value.provider !== "claude-code") || (value.kind !== "root" && value.kind !== "subagent") || !["working", "waiting", "blocked", "done", "idle"].includes(value.state) || typeof value.active !== "boolean" || typeof value.unread !== "boolean") throw new TypeError("agent entry is invalid");
    return Object.freeze({ ...value });
  }

  private projectEntries(entries: Readonly<Record<string, AgentClientEntry>>): Readonly<Record<string, AgentClientEntry>> {
    return Object.fromEntries(Object.entries(entries).filter(([, entry]) => this.sessions.has(entry.activationTerminalSessionId)));
  }

  private publish(): void { for (const listener of this.listeners) { try { listener(this.current); } catch { /* observer failures cannot change projection */ } } }
}

function freezeSnapshot(value: { readonly revision: number; readonly cursor: string; readonly entries: Readonly<Record<string, AgentClientEntry>> }): AgentClientSnapshot {
  return Object.freeze({ revision: value.revision, cursor: value.cursor, entries: Object.freeze({ ...value.entries }) });
}

function sameEntryProjection(left: Readonly<Record<string, AgentClientEntry>>, right: Readonly<Record<string, AgentClientEntry>>): boolean {
  const leftIds = Object.keys(left);
  const rightIds = Object.keys(right);
  return leftIds.length === rightIds.length
    && leftIds.every((entryId, index) => entryId === rightIds[index] && JSON.stringify(left[entryId]) === JSON.stringify(right[entryId]));
}

function validateRevision(revision: unknown, cursor: unknown): void {
  if (!Number.isSafeInteger(revision) || (revision as number) < 0 || cursor !== String(revision)) throw new TypeError("agent event revision is invalid");
}
