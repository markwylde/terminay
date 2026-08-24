import type {
  AgentEventCursor,
  AgentLifecycleEvent,
  AgentState,
  AgentStatusEntry,
  AgentStatusListener,
  AgentStatusSnapshot,
  AgentToolStatus,
  RootAgentStatusEntry,
  SubagentStatusEntry,
} from "./agentTypes.js";

const ATTENTION_STATES: ReadonlySet<AgentState> = new Set(["waiting", "blocked", "done"]);

export function makeAgentStatusEntryId(activationTerminalSessionId: string, sessionId: string, agentId = sessionId): string {
  return [activationTerminalSessionId, sessionId, agentId].map(encodeURIComponent).join(":");
}

export function makeAgentStatusStreamId(provider: string, activationTerminalSessionId: string, sessionId: string): string {
  return [provider, activationTerminalSessionId, sessionId].map(encodeURIComponent).join(":");
}

export function createEmptyAgentStatusSnapshot(): AgentStatusSnapshot {
  return Object.freeze({ revision: 0, entries: Object.freeze({}), eventCursors: Object.freeze({}) });
}

function compareEntries(left: AgentStatusEntry, right: AgentStatusEntry): number {
  return left.activationTerminalSessionId.localeCompare(right.activationTerminalSessionId) ||
    left.sessionId.localeCompare(right.sessionId) ||
    (left.kind === right.kind ? 0 : left.kind === "root" ? -1 : 1) ||
    left.agentId.localeCompare(right.agentId);
}

function rootEntryFor(event: AgentLifecycleEvent): RootAgentStatusEntry {
  return {
    entryId: makeAgentStatusEntryId(event.activationTerminalSessionId, event.sessionId),
    kind: "root",
    provider: event.provider,
    agentId: event.sessionId,
    sessionId: event.sessionId,
    activationTerminalSessionId: event.activationTerminalSessionId,
    terminalSessionId: event.activationTerminalSessionId,
    inProcess: false,
    state: "idle",
    stateStartedAt: event.occurredAt,
    updatedAt: event.occurredAt,
    lastEventKind: event.kind,
    lastEventSequence: event.sequence,
    active: true,
    activeTools: [],
    unread: false,
  };
}

function subagentEntryFor(event: Extract<AgentLifecycleEvent, { kind: "subagent.started" | "subagent.stopped" }>): SubagentStatusEntry {
  const parentAgentId = event.kind === "subagent.started" ? (event.parentAgentId ?? event.sessionId) : event.sessionId;
  return {
    entryId: makeAgentStatusEntryId(event.activationTerminalSessionId, event.sessionId, event.subagentId),
    kind: "subagent",
    provider: event.provider,
    agentId: event.subagentId,
    sessionId: event.sessionId,
    activationTerminalSessionId: event.activationTerminalSessionId,
    terminalSessionId: null,
    inProcess: true,
    parentAgentId,
    parentEntryId: makeAgentStatusEntryId(event.activationTerminalSessionId, event.sessionId, parentAgentId),
    state: "idle",
    stateStartedAt: event.occurredAt,
    updatedAt: event.occurredAt,
    lastEventKind: event.kind,
    lastEventSequence: event.sequence,
    active: false,
    activeTools: [],
    unread: false,
  };
}

function targetAgentId(event: AgentLifecycleEvent): string {
  if ("subagentId" in event) return event.subagentId;
  return "agentId" in event && event.agentId ? event.agentId : event.sessionId;
}

function targetEntry(snapshot: AgentStatusSnapshot, event: AgentLifecycleEvent): AgentStatusEntry | undefined {
  const agentId = targetAgentId(event);
  const existing = snapshot.entries[makeAgentStatusEntryId(event.activationTerminalSessionId, event.sessionId, agentId)];
  if (existing) return existing;
  if (event.kind === "subagent.started" || event.kind === "subagent.stopped") return subagentEntryFor(event);
  if (agentId !== event.sessionId) return undefined;
  return rootEntryFor(event);
}

function addTool(tools: readonly AgentToolStatus[], tool: AgentToolStatus): readonly AgentToolStatus[] {
  return [...tools.filter((candidate) => candidate.id !== tool.id), tool].sort((left, right) => left.id.localeCompare(right.id));
}

function withState(entry: AgentStatusEntry, state: AgentState, event: AgentLifecycleEvent, changes: Partial<AgentStatusEntry> = {}): AgentStatusEntry {
  return {
    ...entry,
    ...changes,
    ...(event.promptText === undefined || (entry.kind === "root" && entry.promptText !== undefined)
      ? {}
      : { promptText: event.promptText }),
    ...(event.model === undefined ? {} : { model: event.model }),
    state,
    stateStartedAt: state === entry.state ? entry.stateStartedAt : event.occurredAt,
    updatedAt: event.occurredAt,
    lastEventKind: event.kind,
    lastEventSequence: event.sequence,
    unread: entry.unread || ATTENTION_STATES.has(state),
  } as AgentStatusEntry;
}

function applyEvent(entry: AgentStatusEntry, event: AgentLifecycleEvent): AgentStatusEntry {
  switch (event.kind) {
    case "session.started":
      return withState(entry, "idle", event, { active: true, activeTools: [], displayName: event.displayName ?? entry.displayName, waitingReason: undefined, completionOutcome: undefined, summary: undefined, exitCode: undefined, exitSignal: undefined });
    case "agent.metadata":
      // Provider model changes are observational. In particular, a model
      // switch while a turn is working must not reset it to idle.
      return withState(entry, entry.state, event, { displayName: event.displayName ?? entry.displayName });
    case "session.stopped":
      return withState(entry, "idle", event, { active: false, activeTools: [], waitingReason: undefined, summary: event.reason ?? entry.summary });
    case "turn.started":
      return withState(entry, "working", event, { active: true, activeTools: [], currentTurnId: event.turnId, waitingReason: undefined, completionOutcome: undefined, summary: undefined });
    case "tool.started":
      return withState(entry, "working", event, { active: true, activeTools: addTool(entry.activeTools, { ...event.tool, startedAt: event.occurredAt }), waitingReason: undefined });
    case "tool.finished":
      return withState(entry, "working", event, { active: true, activeTools: entry.activeTools.filter((tool) => tool.id !== event.toolId), waitingReason: undefined });
    case "wait.started":
      return withState(entry, event.state, event, { active: true, waitingReason: event.reason });
    case "wait.finished":
      return withState(entry, "working", event, { active: true, waitingReason: undefined });
    case "agent.done":
      return withState(entry, "done", event, { active: true, activeTools: [], waitingReason: undefined, completionOutcome: event.outcome, summary: event.summary });
    case "subagent.started":
      return withState(entry, "working", event, { active: true, activeTools: [], displayName: event.displayName ?? entry.displayName, waitingReason: undefined, completionOutcome: undefined, summary: undefined });
    case "subagent.stopped":
      return withState(entry, "done", event, { active: false, activeTools: [], waitingReason: undefined, completionOutcome: event.outcome, summary: event.summary });
    case "agent.exited":
      return withState(entry, "done", event, { active: false, activeTools: [], waitingReason: undefined, exitCode: event.exitCode, exitSignal: event.signal, completionOutcome: event.exitCode === undefined || event.exitCode === 0 ? entry.completionOutcome : "error" });
  }
}

function orderedAfter(cursor: AgentEventCursor | undefined, event: AgentLifecycleEvent): boolean {
  return Number.isSafeInteger(event.sequence) && event.sequence >= 0 && Number.isFinite(event.occurredAt) &&
    (cursor === undefined || (event.sequence > cursor.sequence && event.occurredAt >= cursor.occurredAt));
}

export function reduceAgentStatusSnapshot(snapshot: AgentStatusSnapshot, event: AgentLifecycleEvent): AgentStatusSnapshot {
  const streamId = makeAgentStatusStreamId(event.provider, event.activationTerminalSessionId, event.sessionId);
  if (!orderedAfter(snapshot.eventCursors[streamId], event)) return snapshot;
  const entry = targetEntry(snapshot, event);
  if (!entry) return snapshot;
  const nextEntry = applyEvent(entry, event);
  return Object.freeze({
    revision: snapshot.revision + 1,
    entries: Object.freeze({ ...snapshot.entries, [nextEntry.entryId]: Object.freeze(nextEntry) }),
    eventCursors: Object.freeze({ ...snapshot.eventCursors, [streamId]: Object.freeze({ sequence: event.sequence, occurredAt: event.occurredAt }) }),
  });
}

export function selectAgentStatusEntries(snapshot: AgentStatusSnapshot): readonly AgentStatusEntry[] {
  return Object.values(snapshot.entries).sort(compareEntries);
}

export function selectAgentStatusesForTerminal(snapshot: AgentStatusSnapshot, terminalSessionId: string): readonly AgentStatusEntry[] {
  return selectAgentStatusEntries(snapshot).filter((entry) => entry.activationTerminalSessionId === terminalSessionId);
}

export function selectLiveAgentStatusesForTerminal(snapshot: AgentStatusSnapshot, terminalSessionId: string): readonly AgentStatusEntry[] {
  return selectAgentStatusesForTerminal(snapshot, terminalSessionId).filter((entry) => entry.active);
}

export function selectAgentStatusEntry(snapshot: AgentStatusSnapshot, entryId: string): AgentStatusEntry | undefined {
  return snapshot.entries[entryId];
}

export class AgentStatusStore {
  private snapshot: AgentStatusSnapshot;
  private readonly listeners = new Set<AgentStatusListener>();

  constructor(initialSnapshot: AgentStatusSnapshot = createEmptyAgentStatusSnapshot()) { this.snapshot = initialSnapshot; }
  getSnapshot = (): AgentStatusSnapshot => this.snapshot;
  subscribe = (listener: AgentStatusListener): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };

  dispatch(event: AgentLifecycleEvent): boolean {
    const next = reduceAgentStatusSnapshot(this.snapshot, event);
    if (next === this.snapshot) return false;
    this.publish(next);
    return true;
  }

  /** Atomically applies a validated publication. A rejected event must never
   * leave the sidebar at a prefix of the provider's publication. */
  dispatchBatch(events: readonly AgentLifecycleEvent[]): boolean {
    let next = this.snapshot;
    for (const event of events) {
      const reduced = reduceAgentStatusSnapshot(next, event);
      if (reduced === next) return false;
      next = reduced;
    }
    if (next === this.snapshot) return false;
    this.publish(next);
    return true;
  }

  markAcknowledged(entryId: string, acknowledgedAt = Date.now()): boolean {
    const entry = this.snapshot.entries[entryId];
    if (!entry || !Number.isFinite(acknowledgedAt)) return false;
    // Acknowledging an already-read entry is intentionally a no-op. In
    // particular, do not let a later duplicate acknowledgement from another
    // client mutate acknowledgement metadata and create a new revision.
    if (!entry.unread) return false;
    const timestamp = Math.max(entry.acknowledgedAt ?? -Infinity, acknowledgedAt);
    this.publish(Object.freeze({ ...this.snapshot, revision: this.snapshot.revision + 1, entries: Object.freeze({ ...this.snapshot.entries, [entryId]: Object.freeze({ ...entry, unread: false, acknowledgedAt: timestamp }) }) }));
    return true;
  }

  markTerminalAcknowledged(terminalSessionId: string, acknowledgedAt = Date.now()): number {
    if (!Number.isFinite(acknowledgedAt)) return 0;
    const entries = selectAgentStatusesForTerminal(this.snapshot, terminalSessionId).filter((entry) => entry.unread);
    if (entries.length === 0) return 0;
    const nextEntries = { ...this.snapshot.entries };
    for (const entry of entries) nextEntries[entry.entryId] = Object.freeze({ ...entry, unread: false, acknowledgedAt: Math.max(entry.acknowledgedAt ?? -Infinity, acknowledgedAt) });
    this.publish(Object.freeze({ ...this.snapshot, revision: this.snapshot.revision + 1, entries: Object.freeze(nextEntries) }));
    return entries.length;
  }

  clear(): boolean {
    if (Object.keys(this.snapshot.entries).length === 0 && Object.keys(this.snapshot.eventCursors).length === 0) return false;
    this.publish(Object.freeze({ revision: this.snapshot.revision + 1, entries: Object.freeze({}), eventCursors: Object.freeze({}) }));
    return true;
  }

  private publish(snapshot: AgentStatusSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of [...this.listeners]) {
      try { listener(snapshot); } catch { /* observers cannot roll back server state */ }
    }
  }
}
