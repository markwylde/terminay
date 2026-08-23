import { createAgentDriverRegistry, type AgentDriverRegistry } from "./agentDrivers.js";
import { NodeAgentJournalSource, type AgentJournalSource } from "./agentJournal.js";
import { AgentStatusStore, makeAgentStatusEntryId, makeAgentStatusStreamId, selectAgentStatusEntry, selectAgentStatusesForTerminal } from "./agentStore.js";
import type { AgentLifecycleEvent, AgentProvider, AgentStatusListener, AgentStatusSnapshot } from "./agentTypes.js";
import type { ActivitySessionIdentity, TerminalActivityService } from "./service.js";
import type { ProviderActivityState, ProviderActivityUpdate } from "./types.js";

export interface AgentStatusServiceOptions {
  readonly activity: TerminalActivityService;
  readonly driverRegistry?: AgentDriverRegistry;
  readonly journalSource?: AgentJournalSource;
  readonly now?: () => number;
  readonly store?: AgentStatusStore;
  readonly enabled?: boolean;
  readonly foregroundExitConfirmationMs?: number;
}

interface ProviderBinding {
  readonly provider: AgentProvider;
  readonly providerSessionId: string;
  readonly providerVersion?: string;
  readonly mappingVersion: string;
}

const DEFAULT_FOREGROUND_EXIT_CONFIRMATION_MS = 500;

export function providerFromForegroundProcess(processName: string): AgentProvider | null {
  const executable = processName.trim().split(/[\\/]/u).pop()?.toLowerCase() ?? "";
  if (/^codex(?:[-_.]|$)/u.test(executable)) return "codex";
  if (/^claude(?:[-_.]|$)/u.test(executable)) return "claude-code";
  // A macOS shebang launch exposes Bun as the PTY foreground executable.
  // This is only a journal-discovery hint: NodeAgentJournalSource still
  // requires a materialized OMP root JSONL selected by the exact PTY's
  // terminal-scoped breadcrumb before it emits an authoritative record.
  return /^(?:omp|oh-my-pi|bun)(?:[-_.]|$)/u.test(executable) ? "omp" : null;
}

/** Server-owned, zero-install agent journal authority. */
export class AgentStatusService {
  readonly drivers: AgentDriverRegistry;
  private readonly activity: TerminalActivityService;
  private readonly journalSource: AgentJournalSource;
  private readonly now: () => number;
  private readonly store: AgentStatusStore;
  private readonly active = new Map<string, ActivitySessionIdentity>();
  private readonly sessionScopes = new Map<string, ActivitySessionIdentity>();
  private readonly bindings = new Map<string, ProviderBinding>();
  private readonly sequences = new Map<string, Map<string, number>>();
  private readonly pendingSubagentLaunches = new Map<string, Array<{ readonly displayName?: string; readonly promptText?: string; readonly toolId: string }>>();
  private readonly foregroundProviderBySession = new Map<string, AgentProvider | null>();
  private readonly pendingForegroundExits = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly foregroundExitConfirmationMs: number;
  private started = false;
  private enabled: boolean;

  constructor(options: AgentStatusServiceOptions) {
    this.activity = options.activity;
    this.drivers = options.driverRegistry ?? createAgentDriverRegistry();
    this.journalSource = options.journalSource ?? new NodeAgentJournalSource();
    this.now = options.now ?? Date.now;
    this.store = options.store ?? new AgentStatusStore();
    this.enabled = options.enabled ?? true;
    this.foregroundExitConfirmationMs = Math.max(0, options.foregroundExitConfirmationMs ?? DEFAULT_FOREGROUND_EXIT_CONFIRMATION_MS);
  }

  getSnapshot(): AgentStatusSnapshot { return this.store.getSnapshot(); }
  isSessionActive(identity: ActivitySessionIdentity): boolean {
    const current = this.active.get(identity.sessionId);
    return current !== undefined && current.serverId === identity.serverId && current.projectId === identity.projectId;
  }
  getSnapshotForProject(projectId: string | undefined): AgentStatusSnapshot { return this.filterSnapshotForProject(this.store.getSnapshot(), projectId); }
  filterSnapshotForProject(snapshot: AgentStatusSnapshot, projectId: string | undefined): AgentStatusSnapshot {
    if (projectId === undefined) return snapshot;
    const entries = Object.fromEntries(Object.entries(snapshot.entries).filter(([, entry]) => this.sessionScopes.get(entry.activationTerminalSessionId)?.projectId === projectId));
    return Object.freeze({ ...snapshot, entries: Object.freeze(entries) });
  }
  subscribe(listener: AgentStatusListener): () => void { return this.store.subscribe(listener); }
  get listening(): boolean { return this.started; }
  get serverId(): string { return this.activity.serverId; }
  get integrationEnabled(): boolean { return this.enabled; }

  async start(): Promise<void> {
    if (this.started) return;
    await this.journalSource.start((observation) => {
      void this.ingestJournalRecord(observation.identity, observation.provider, observation.record, {
        journalRole: observation.journalRole,
        childAgentId: observation.childAgentId,
      }).catch(() => undefined);
    });
    this.started = true;
  }

  async stop(): Promise<void> {
    for (const identity of [...this.active.values()]) this.terminalExited(identity);
    this.active.clear(); this.sessionScopes.clear(); this.bindings.clear(); this.sequences.clear();
    this.clearForegroundTracking(); this.pendingSubagentLaunches.clear();
    this.started = false;
    await this.journalSource.stop();
  }

  setIntegrationEnabled(enabled: boolean): boolean {
    if (typeof enabled !== "boolean") throw new TypeError("agent integration enabled must be boolean");
    if (this.enabled === enabled) return false;
    this.enabled = enabled;
    this.journalSource.setEnabled(enabled);
    if (!enabled) {
      this.active.clear(); this.sessionScopes.clear(); this.bindings.clear(); this.sequences.clear();
      this.clearForegroundTracking(); this.pendingSubagentLaunches.clear(); this.store.clear();
    }
    return true;
  }

  register(identity: ActivitySessionIdentity): void {
    if (!this.started) throw new Error("agent status service is not running");
    if (!this.enabled) return;
    const frozen = Object.freeze({ ...identity });
    this.active.set(identity.sessionId, frozen);
    this.sessionScopes.set(identity.sessionId, frozen);
    this.journalSource.registerTerminal(identity);
  }

  terminalStarted(identity: ActivitySessionIdentity, shellPid: number): void {
    if (!this.isSessionActive(identity)) return;
    this.journalSource.terminalStarted(identity, shellPid);
  }

  terminalExited(identity: ActivitySessionIdentity, options: { readonly exitCode?: number; readonly signal?: string } = {}): void {
    const current = this.active.get(identity.sessionId);
    if (!current || current.projectId !== identity.projectId || current.serverId !== identity.serverId) return;
    this.active.delete(identity.sessionId);
    this.bindings.delete(identity.sessionId);
    this.sequences.delete(identity.sessionId);
    this.removePendingSubagentLaunches(identity.sessionId);
    this.clearForegroundTrackingForSession(identity.sessionId);
    this.journalSource.unregisterTerminal(identity);
    const entries = selectAgentStatusesForTerminal(this.store.getSnapshot(), identity.sessionId).filter((entry) => entry.active);
    let exitSequence = Math.max(0, ...entries.map((entry) => entry.lastEventSequence)) + 1;
    for (const entry of entries) {
      this.store.dispatch({
        provider: entry.provider, sessionId: entry.sessionId, activationTerminalSessionId: identity.sessionId,
        agentId: entry.agentId, kind: "agent.exited", sequence: exitSequence++, occurredAt: Math.max(this.now(), entry.updatedAt),
        ...(options.exitCode === undefined ? {} : { exitCode: options.exitCode }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    }
  }

  abandonTerminalSession(identity: ActivitySessionIdentity): void {
    const current = this.active.get(identity.sessionId);
    if (!current || current.projectId !== identity.projectId || current.serverId !== identity.serverId) return;
    this.active.delete(identity.sessionId); this.bindings.delete(identity.sessionId); this.sequences.delete(identity.sessionId);
    this.removePendingSubagentLaunches(identity.sessionId); this.clearForegroundTrackingForSession(identity.sessionId);
    this.journalSource.unregisterTerminal(identity);
  }

  acknowledge(identity: ActivitySessionIdentity, entryId?: string): boolean {
    this.assertActive(identity);
    if (entryId === undefined) {
      const changed = this.store.markTerminalAcknowledged(identity.sessionId, this.now()) > 0;
      this.activity.acknowledge(identity);
      return changed;
    }
    const entry = selectAgentStatusEntry(this.store.getSnapshot(), entryId);
    if (!entry || entry.activationTerminalSessionId !== identity.sessionId) return false;
    const changed = this.store.markAcknowledged(entryId, this.now());
    if (changed) this.activity.acknowledge(identity);
    return changed;
  }

  /** Testable server-side boundary used by the journal source and fixtures. */
  async ingestJournalRecord(
    identity: ActivitySessionIdentity,
    provider: AgentProvider,
    record: Readonly<Record<string, unknown>>,
    source: { readonly journalRole?: "root" | "child"; readonly childAgentId?: string } = {},
  ): Promise<boolean> {
    this.assertActive(identity);
    // A child omp journal has its own session header, but that header belongs
    // beneath the root binding and must never replace the PTY's root session.
    const inspected = source.journalRole === "child" ? null : this.drivers.inspectSession(provider, record);
    if (inspected !== null) {
      const resolved = this.drivers.resolve(provider, inspected.session.providerVersion);
      if (!resolved) return false;
      const previous = this.bindings.get(identity.sessionId);
      if (previous && (previous.provider !== provider || previous.providerSessionId !== inspected.session.providerSessionId)) {
        this.retireBinding(identity, previous);
      }
      this.bindings.set(identity.sessionId, {
        provider, providerSessionId: inspected.session.providerSessionId,
        providerVersion: inspected.session.providerVersion, mappingVersion: resolved.mappingVersion,
      });
    }
    const binding = this.bindings.get(identity.sessionId);
    if (!binding || binding.provider !== provider) return false;
    const sequence = this.nextSequence(provider, identity.sessionId);
    const normalized = this.drivers.normalize(provider, binding.providerVersion, record, {
      activationTerminalSessionId: identity.sessionId, sequence, occurredAt: this.now(), providerSessionId: binding.providerSessionId,
      journalRole: source.journalRole ?? "root", childAgentId: source.childAgentId,
    });
    if (normalized === null) return false;
    const events = Array.isArray(normalized) ? normalized : [normalized];
    if (events.length === 0) return false;
    if (events.length > 1) this.advanceSequence(provider, identity.sessionId, events.length - 1);
    this.foregroundProviderBySession.set(identity.sessionId, provider);
    this.cancelPendingForegroundExit(identity.sessionId);
    for (const [index, original] of events.entries()) {
      const event = index === 0 ? original : { ...original, sequence: sequence + index };
      validateLifecycleEvent(event, provider, identity.sessionId);
      const correlated = this.correlateSubagentLaunch(event);
      this.store.dispatch(correlated);
      // Metadata is authoritative for the Agents snapshot but deliberately
      // leaves the terminal activity state untouched.
      if (correlated.kind !== "agent.metadata") this.activity.ingestProvider(identity, toProviderUpdate(correlated));
    }
    return true;
  }

  foregroundProcessChanged(identity: ActivitySessionIdentity, processName: string, shellForeground: boolean): void {
    if (!this.active.has(identity.sessionId)) return;
    const provider = providerFromForegroundProcess(processName);
    this.journalSource.foregroundProcessChanged(identity, provider, shellForeground);
    const previous = this.foregroundProviderBySession.get(identity.sessionId);
    if (provider !== null) {
      this.foregroundProviderBySession.set(identity.sessionId, provider);
      this.cancelPendingForegroundExit(identity.sessionId);
      return;
    }
    if (!shellForeground || previous === undefined || previous === null) return;
    this.foregroundProviderBySession.set(identity.sessionId, null);
    this.scheduleForegroundExit(identity, previous);
  }

  private assertActive(identity: ActivitySessionIdentity): void {
    const current = this.active.get(identity.sessionId);
    if (!current || current.serverId !== identity.serverId || current.projectId !== identity.projectId) throw new Error("agent journal session is not active for this project");
  }

  private nextSequence(provider: string, sessionId: string): number {
    const providerSequences = this.sequences.get(sessionId) ?? new Map<string, number>();
    this.sequences.set(sessionId, providerSequences);
    const next = providerSequences.get(provider) ?? 1;
    providerSequences.set(provider, next + 1);
    return next;
  }

  private advanceSequence(provider: string, sessionId: string, count: number): void {
    const providerSequences = this.sequences.get(sessionId);
    if (providerSequences) providerSequences.set(provider, (providerSequences.get(provider) ?? 1) + count);
  }

  private retireBinding(identity: ActivitySessionIdentity, binding: ProviderBinding): void {
    const root = selectAgentStatusesForTerminal(this.store.getSnapshot(), identity.sessionId)
      .find((entry) => entry.kind === "root" && entry.provider === binding.provider && entry.sessionId === binding.providerSessionId && entry.active);
    if (!root) return;
    const event: AgentLifecycleEvent = {
      kind: "session.stopped",
      provider: binding.provider,
      sessionId: binding.providerSessionId,
      activationTerminalSessionId: identity.sessionId,
      sequence: this.nextSequence(binding.provider, identity.sessionId),
      occurredAt: Math.max(this.now(), root.updatedAt),
      reason: "rollout-switched",
    };
    this.store.dispatch(event);
    this.activity.ingestProvider(identity, toProviderUpdate(event));
  }

  private correlateSubagentLaunch(event: AgentLifecycleEvent): AgentLifecycleEvent {
    const streamId = makeAgentStatusStreamId(event.provider, event.activationTerminalSessionId, event.sessionId);
    if (event.kind === "tool.started" && event.tool.subagentLaunch !== undefined) {
      const pending = this.pendingSubagentLaunches.get(streamId) ?? [];
      this.pendingSubagentLaunches.set(streamId, [...pending, { ...event.tool.subagentLaunch, toolId: event.tool.id }].slice(-32));
      return event;
    }
    if (event.kind === "tool.finished") {
      const child = selectAgentStatusEntry(this.store.getSnapshot(), makeAgentStatusEntryId(event.activationTerminalSessionId, event.sessionId, event.toolId));
      if (child?.kind === "subagent" && child.active) {
        return { ...event, kind: "agent.done", agentId: child.agentId, outcome: event.outcome };
      }
      const pending = this.pendingSubagentLaunches.get(streamId);
      if (pending !== undefined) {
        const next = pending.filter((candidate) => candidate.toolId !== event.toolId);
        if (next.length === 0) this.pendingSubagentLaunches.delete(streamId); else this.pendingSubagentLaunches.set(streamId, next);
      }
      return event;
    }
    if (event.kind !== "subagent.started") return event;
    const pending = this.pendingSubagentLaunches.get(streamId);
    const launch = pending?.shift();
    if (pending !== undefined && pending.length === 0) this.pendingSubagentLaunches.delete(streamId);
    return launch === undefined ? event : { ...event, displayName: launch.displayName ?? event.displayName, promptText: event.promptText ?? launch.promptText };
  }

  private removePendingSubagentLaunches(sessionId: string): void {
    for (const [streamId] of this.pendingSubagentLaunches) if (streamId.split(":").some((part) => decodeURIComponent(part) === sessionId)) this.pendingSubagentLaunches.delete(streamId);
  }

  private scheduleForegroundExit(identity: ActivitySessionIdentity, provider: AgentProvider): void {
    if (this.pendingForegroundExits.has(identity.sessionId)) return;
    const roots = selectAgentStatusesForTerminal(this.store.getSnapshot(), identity.sessionId).filter((entry) => entry.kind === "root" && entry.provider === provider && entry.active);
    if (roots.length === 0) return;
    const timer = setTimeout(() => {
      this.pendingForegroundExits.delete(identity.sessionId);
      if (this.foregroundProviderBySession.get(identity.sessionId) !== null || !this.active.has(identity.sessionId)) return;
      for (const root of roots) {
        const current = selectAgentStatusEntry(this.store.getSnapshot(), root.entryId);
        if (current?.kind !== "root" || !current.active) continue;
        const cursor = this.store.getSnapshot().eventCursors[makeAgentStatusStreamId(root.provider, root.activationTerminalSessionId, root.sessionId)];
        this.store.dispatch({ kind: "session.stopped", provider: root.provider, sessionId: root.sessionId, activationTerminalSessionId: root.activationTerminalSessionId, sequence: (cursor?.sequence ?? root.lastEventSequence) + 1, occurredAt: Math.max(this.now(), cursor?.occurredAt ?? root.updatedAt), reason: "foreground-shell" });
      }
    }, this.foregroundExitConfirmationMs);
    this.pendingForegroundExits.set(identity.sessionId, timer);
  }

  private cancelPendingForegroundExit(sessionId: string): void { const timer = this.pendingForegroundExits.get(sessionId); if (timer !== undefined) { clearTimeout(timer); this.pendingForegroundExits.delete(sessionId); } }
  private clearForegroundTrackingForSession(sessionId: string): void { this.cancelPendingForegroundExit(sessionId); this.foregroundProviderBySession.delete(sessionId); }
  private clearForegroundTracking(): void { for (const id of this.pendingForegroundExits.keys()) this.cancelPendingForegroundExit(id); this.foregroundProviderBySession.clear(); }
}

function toProviderUpdate(event: AgentLifecycleEvent): ProviderActivityUpdate {
  let state: ProviderActivityState;
  switch (event.kind) {
    case "session.started": case "session.stopped": state = "idle"; break;
    case "wait.started": state = event.state; break;
    case "agent.done": case "agent.exited": state = "done"; break;
    default: state = "working";
  }
  const agentId = "subagentId" in event ? event.subagentId : "agentId" in event && event.agentId ? event.agentId : event.sessionId;
  return Object.freeze({ provider: event.provider, state, sequence: event.sequence, agentId, source: `journal:${event.provider}` });
}

function validateLifecycleEvent(event: AgentLifecycleEvent, provider: string, terminalSessionId: string): void {
  if (!event || typeof event !== "object" || event.provider !== provider || event.activationTerminalSessionId !== terminalSessionId) throw new Error("agent driver returned an invalid scope");
  if (typeof event.sessionId !== "string" || event.sessionId.length === 0 || event.sessionId.length > 512) throw new Error("agent driver returned an invalid provider session");
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 0 || !Number.isFinite(event.occurredAt)) throw new Error("agent driver returned invalid ordering metadata");
  if ("agentId" in event && event.agentId !== undefined && (typeof event.agentId !== "string" || event.agentId.length === 0 || event.agentId.length > 512)) throw new Error("agent driver returned an invalid agent id");
  if ("subagentId" in event && (typeof event.subagentId !== "string" || event.subagentId.length === 0 || event.subagentId.length > 512)) throw new Error("agent driver returned an invalid subagent id");
}
