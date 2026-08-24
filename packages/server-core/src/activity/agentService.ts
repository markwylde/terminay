import { validateAgentLifecycleEvent, validateAgentSessionBindingRequest, type AgentLifecycleEvent as ExtensionAgentLifecycleEvent } from "@terminay/extension-api";
import { AgentStatusStore, makeAgentStatusEntryId, makeAgentStatusStreamId, selectAgentStatusEntry, selectAgentStatusesForTerminal } from "./agentStore.js";
import { isExtensionAgentProvider, type AgentLifecycleEvent as CanonicalAgentLifecycleEvent, type AgentProvider, type AgentStatusListener, type AgentStatusSnapshot } from "./agentTypes.js";
import type { ActivitySessionIdentity, TerminalActivityService } from "./service.js";
import type { ProviderActivityState, ProviderActivityUpdate } from "./types.js";

/** Options for the canonical, provider-neutral sidebar projection. */
export interface AgentStatusServiceOptions {
  readonly activity: TerminalActivityService;
  readonly now?: () => number;
  readonly store?: AgentStatusStore;
  readonly enabled?: boolean;
}

interface ProviderBinding {
  readonly provider: AgentProvider;
  readonly providerSessionId: string;
  readonly mappingVersion: string;
}

export interface ExtensionLifecycleIngestResult {
  readonly acceptedEventCount: number;
  readonly rejectedEventCount: number;
  readonly failure?: string;
}

/**
 * Canonical lifecycle reducer for extension-published agent events.
 *
 * Provider discovery, transcript observation, and native-record mapping are
 * extension responsibilities. This service accepts only public validated DTOs
 * after a host has admitted an exact terminal incarnation.
 */
export class AgentStatusService {
  private readonly activity: TerminalActivityService;
  private readonly now: () => number;
  private readonly store: AgentStatusStore;
  private readonly active = new Map<string, ActivitySessionIdentity>();
  private readonly sessionScopes = new Map<string, ActivitySessionIdentity>();
  private readonly bindings = new Map<string, ProviderBinding>();
  private readonly extensionProviderBySession = new Map<string, AgentProvider>();
  private readonly sequences = new Map<string, Map<string, number>>();
  private readonly pendingSubagentLaunches = new Map<string, Array<{ readonly displayName?: string; readonly promptText?: string; readonly toolId: string }>>();
  private started = false;
  private enabled: boolean;

  constructor(options: AgentStatusServiceOptions) {
    this.activity = options.activity;
    this.now = options.now ?? Date.now;
    this.store = options.store ?? new AgentStatusStore();
    this.enabled = options.enabled ?? true;
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

  async start(): Promise<void> { this.started = true; }
  async stop(): Promise<void> {
    for (const identity of [...this.active.values()]) this.terminalExited(identity);
    this.active.clear(); this.sessionScopes.clear(); this.bindings.clear(); this.extensionProviderBySession.clear(); this.sequences.clear(); this.pendingSubagentLaunches.clear();
    this.started = false;
  }

  setIntegrationEnabled(enabled: boolean): boolean {
    if (typeof enabled !== "boolean") throw new TypeError("agent integration enabled must be boolean");
    if (this.enabled === enabled) return false;
    this.enabled = enabled;
    if (!enabled) {
      this.active.clear(); this.sessionScopes.clear(); this.bindings.clear(); this.extensionProviderBySession.clear(); this.sequences.clear(); this.pendingSubagentLaunches.clear(); this.store.clear();
    }
    return true;
  }

  register(identity: ActivitySessionIdentity): void {
    if (!this.started) throw new Error("agent status service is not running");
    if (!this.enabled) return;
    const frozen = Object.freeze({ ...identity });
    this.active.set(identity.sessionId, frozen);
    this.sessionScopes.set(identity.sessionId, frozen);
  }

  /** Terminal process details are owned by extension admission, not this reducer. */
  terminalStarted(identity: ActivitySessionIdentity, _shellPid: number): void { this.assertActive(identity); }

  terminalExited(identity: ActivitySessionIdentity, options: { readonly exitCode?: number; readonly signal?: string } = {}): void {
    const current = this.active.get(identity.sessionId);
    if (!current || current.projectId !== identity.projectId || current.serverId !== identity.serverId) return;
    this.active.delete(identity.sessionId); this.bindings.delete(identity.sessionId); this.extensionProviderBySession.delete(identity.sessionId); this.sequences.delete(identity.sessionId);
    this.removePendingSubagentLaunches(identity.sessionId);
    const entries = selectAgentStatusesForTerminal(this.store.getSnapshot(), identity.sessionId).filter((entry) => entry.active);
    let exitSequence = Math.max(0, ...entries.map((entry) => entry.lastEventSequence)) + 1;
    for (const entry of entries) this.store.dispatch({
      provider: entry.provider, sessionId: entry.sessionId, activationTerminalSessionId: identity.sessionId,
      agentId: entry.agentId, kind: "agent.exited", sequence: exitSequence++, occurredAt: Math.max(this.now(), entry.updatedAt),
      ...(options.exitCode === undefined ? {} : { exitCode: options.exitCode }), ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  }

  abandonTerminalSession(identity: ActivitySessionIdentity): void {
    const current = this.active.get(identity.sessionId);
    if (!current || current.projectId !== identity.projectId || current.serverId !== identity.serverId) return;
    this.active.delete(identity.sessionId); this.bindings.delete(identity.sessionId); this.extensionProviderBySession.delete(identity.sessionId); this.sequences.delete(identity.sessionId); this.removePendingSubagentLaunches(identity.sessionId);
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

  claimExtensionProvider(identity: ActivitySessionIdentity, providerId: string): boolean {
    this.assertActive(identity); this.assertExtensionProvider(providerId);
    const previousOwner = this.extensionProviderBySession.get(identity.sessionId);
    if (previousOwner !== undefined && previousOwner !== providerId) throw new Error("another extension provider already owns this terminal session");
    if (previousOwner === providerId) return false;
    const previousBinding = this.bindings.get(identity.sessionId);
    if (previousBinding !== undefined && previousBinding.provider !== providerId) this.retireBinding(identity, previousBinding);
    this.extensionProviderBySession.set(identity.sessionId, providerId);
    return true;
  }

  releaseExtensionProvider(identity: ActivitySessionIdentity, providerId: string): boolean {
    this.assertActive(identity);
    if (this.extensionProviderBySession.get(identity.sessionId) !== providerId) return false;
    const binding = this.bindings.get(identity.sessionId);
    if (binding?.provider === providerId) { this.retireBinding(identity, binding, "extension-released"); this.bindings.delete(identity.sessionId); }
    this.extensionProviderBySession.delete(identity.sessionId);
    this.sequences.get(identity.sessionId)?.delete(providerId);
    return true;
  }

  bindExtensionSession(identity: ActivitySessionIdentity, providerId: string, mappingVersion: string, binding: unknown): boolean {
    this.assertActive(identity); this.assertExtensionClaim(identity, providerId);
    const validated = validateAgentSessionBindingRequest(binding);
    if (!validated.ok) throw new Error("extension agent session binding is invalid");
    if (!isMappingVersion(mappingVersion) || validated.value.mappingVersion !== mappingVersion) throw new Error("extension agent mapping version is invalid");
    const previous = this.bindings.get(identity.sessionId);
    if (previous !== undefined && (previous.provider !== providerId || previous.providerSessionId !== validated.value.providerSessionId)) this.retireBinding(identity, previous);
    this.bindings.set(identity.sessionId, { provider: providerId, providerSessionId: validated.value.providerSessionId, mappingVersion });
    return true;
  }

  async ingestExtensionLifecycle(identity: ActivitySessionIdentity, providerId: string, mappingVersion: string, binding: unknown | undefined, events: readonly unknown[]): Promise<ExtensionLifecycleIngestResult> {
    try {
      this.assertActive(identity); this.assertExtensionClaim(identity, providerId);
      if (!isMappingVersion(mappingVersion)) throw new Error("extension agent mapping version is invalid");
      if (binding !== undefined) this.bindExtensionSession(identity, providerId, mappingVersion, binding);
      const activeBinding = this.bindings.get(identity.sessionId);
      if (activeBinding === undefined || activeBinding.provider !== providerId || activeBinding.mappingVersion !== mappingVersion) throw new Error("extension agent session is not bound");
      if (!Array.isArray(events) || events.length > 64) throw new Error("extension lifecycle publication is invalid");
      let acceptedEventCount = 0;
      for (const candidate of events) {
        const validated = validateAgentLifecycleEvent(candidate);
        if (!validated.ok) return Object.freeze({ acceptedEventCount, rejectedEventCount: events.length - acceptedEventCount, failure: "extension lifecycle event is invalid" });
        const event = this.correlateSubagentLaunch(this.toCanonicalExtensionEvent(identity, providerId, activeBinding, validated.value));
        this.store.dispatch(event);
        if (event.kind !== "agent.metadata") this.activity.ingestProvider(identity, toProviderUpdate(event));
        acceptedEventCount += 1;
      }
      return Object.freeze({ acceptedEventCount, rejectedEventCount: 0 });
    } catch (error) {
      return Object.freeze({ acceptedEventCount: 0, rejectedEventCount: Array.isArray(events) ? events.length : 0, failure: error instanceof Error ? error.message : "extension lifecycle publication failed" });
    }
  }

  /** @deprecated Native records are no longer accepted by Server Core. */
  async ingestJournalRecord(identity: ActivitySessionIdentity, _provider: string, _record: Readonly<Record<string, unknown>>): Promise<boolean> { this.assertActive(identity); return false; }
  /** @deprecated Process matching belongs to manifest-owned extension providers. */
  foregroundProcessChanged(_identity: ActivitySessionIdentity, _processName: string, _shellForeground: boolean): void {}

  private assertActive(identity: ActivitySessionIdentity): void {
    const current = this.active.get(identity.sessionId);
    if (!current || current.serverId !== identity.serverId || current.projectId !== identity.projectId) throw new Error("agent session is not active for this project");
  }
  private nextSequence(provider: string, sessionId: string): number {
    const sequences = this.sequences.get(sessionId) ?? new Map<string, number>(); this.sequences.set(sessionId, sequences);
    const next = sequences.get(provider) ?? 1; sequences.set(provider, next + 1); return next;
  }
  private retireBinding(identity: ActivitySessionIdentity, binding: ProviderBinding, reason = "session-replaced"): void {
    const root = selectAgentStatusesForTerminal(this.store.getSnapshot(), identity.sessionId).find((entry) => entry.kind === "root" && entry.provider === binding.provider && entry.sessionId === binding.providerSessionId && entry.active);
    if (!root) return;
    const event: CanonicalAgentLifecycleEvent = { kind: "session.stopped", provider: binding.provider, sessionId: binding.providerSessionId, activationTerminalSessionId: identity.sessionId, sequence: this.nextSequence(binding.provider, identity.sessionId), occurredAt: Math.max(this.now(), root.updatedAt), reason };
    this.store.dispatch(event); this.activity.ingestProvider(identity, toProviderUpdate(event));
  }
  private correlateSubagentLaunch(event: CanonicalAgentLifecycleEvent): CanonicalAgentLifecycleEvent {
    const streamId = makeAgentStatusStreamId(event.provider, event.activationTerminalSessionId, event.sessionId);
    if (event.kind === "tool.started" && event.tool.subagentLaunch !== undefined) {
      const pending = this.pendingSubagentLaunches.get(streamId) ?? [];
      this.pendingSubagentLaunches.set(streamId, [...pending, { ...event.tool.subagentLaunch, toolId: event.tool.id }].slice(-32)); return event;
    }
    if (event.kind === "tool.finished") {
      const child = selectAgentStatusEntry(this.store.getSnapshot(), makeAgentStatusEntryId(event.activationTerminalSessionId, event.sessionId, event.toolId));
      if (child?.kind === "subagent" && child.active) return { ...event, kind: "agent.done", agentId: child.agentId, outcome: event.outcome };
      const pending = this.pendingSubagentLaunches.get(streamId);
      if (pending !== undefined) { const next = pending.filter((candidate) => candidate.toolId !== event.toolId); if (next.length === 0) this.pendingSubagentLaunches.delete(streamId); else this.pendingSubagentLaunches.set(streamId, next); }
      return event;
    }
    if (event.kind !== "subagent.started") return event;
    const pending = this.pendingSubagentLaunches.get(streamId); const launch = pending?.shift();
    if (pending !== undefined && pending.length === 0) this.pendingSubagentLaunches.delete(streamId);
    return launch === undefined ? event : { ...event, displayName: launch.displayName ?? event.displayName, promptText: event.promptText ?? launch.promptText };
  }
  private removePendingSubagentLaunches(sessionId: string): void { for (const [streamId] of this.pendingSubagentLaunches) if (streamId.split(":").some((part) => decodeURIComponent(part) === sessionId)) this.pendingSubagentLaunches.delete(streamId); }
  private assertExtensionProvider(providerId: string): asserts providerId is AgentProvider { if (!isExtensionAgentProvider(providerId)) throw new Error("extension agent provider id must be a bounded namespaced id"); }
  private assertExtensionClaim(identity: ActivitySessionIdentity, providerId: string): void { this.assertExtensionProvider(providerId); if (this.extensionProviderBySession.get(identity.sessionId) !== providerId) throw new Error("extension agent provider does not own this terminal session"); }
  private toCanonicalExtensionEvent(identity: ActivitySessionIdentity, provider: AgentProvider, binding: ProviderBinding, event: ExtensionAgentLifecycleEvent): CanonicalAgentLifecycleEvent {
    const common = { provider, sessionId: binding.providerSessionId, activationTerminalSessionId: identity.sessionId, sequence: this.nextSequence(provider, identity.sessionId), occurredAt: this.now() } as const;
    switch (event.kind) {
      case "session.started": return { ...common, kind: event.kind, ...(event.title === undefined ? {} : { displayName: event.title }), ...(event.promptText === undefined ? {} : { promptText: event.promptText }), ...(event.model === undefined ? {} : { model: event.model }) };
      case "agent.metadata": return { ...common, kind: event.kind, ...(event.agentId === undefined ? {} : { agentId: event.agentId }), ...(event.title === undefined ? {} : { displayName: event.title }), ...(event.promptText === undefined ? {} : { promptText: event.promptText }), ...(event.model === undefined ? {} : { model: event.model }) };
      case "session.stopped": return { ...common, kind: event.kind, ...(event.reason === undefined ? {} : { reason: event.reason }) };
      case "turn.started": return { ...common, kind: event.kind, ...(event.agentId === undefined ? {} : { agentId: event.agentId }), turnId: event.turnId, ...(event.promptText === undefined ? {} : { promptText: event.promptText }) };
      case "tool.started": return { ...common, kind: event.kind, ...(event.agentId === undefined ? {} : { agentId: event.agentId }), tool: { id: event.toolId, name: event.name, ...(event.description === undefined ? {} : { description: event.description }) } };
      case "tool.finished": return { ...common, kind: event.kind, ...(event.agentId === undefined ? {} : { agentId: event.agentId }), toolId: event.toolId, ...(event.outcome === undefined ? {} : { outcome: event.outcome }) };
      case "wait.started": return { ...common, kind: event.kind, ...(event.agentId === undefined ? {} : { agentId: event.agentId }), state: event.state, ...(event.reason === undefined ? {} : { reason: event.reason }) };
      case "wait.finished": return { ...common, kind: event.kind, ...(event.agentId === undefined ? {} : { agentId: event.agentId }) };
      case "agent.done": return { ...common, kind: event.kind, ...(event.agentId === undefined ? {} : { agentId: event.agentId }), outcome: event.outcome, ...(event.summary === undefined ? {} : { summary: event.summary }) };
      case "agent.exited": return { ...common, kind: event.kind, ...(event.agentId === undefined ? {} : { agentId: event.agentId }), ...(event.exitCode === undefined ? {} : { exitCode: event.exitCode }), ...(event.signal === undefined ? {} : { signal: event.signal }) };
      case "subagent.started": return { ...common, kind: event.kind, subagentId: event.subagentId, ...(event.parentAgentId === undefined ? {} : { parentAgentId: event.parentAgentId }), ...(event.title === undefined ? {} : { displayName: event.title }), ...(event.promptText === undefined ? {} : { promptText: event.promptText }), ...(event.model === undefined ? {} : { model: event.model }) };
      case "subagent.done": return { ...common, kind: "subagent.stopped", subagentId: event.subagentId, outcome: event.outcome, ...(event.summary === undefined ? {} : { summary: event.summary }) };
    }
  }
}

function toProviderUpdate(event: CanonicalAgentLifecycleEvent): ProviderActivityUpdate {
  let state: ProviderActivityState;
  switch (event.kind) { case "session.started": case "session.stopped": state = "idle"; break; case "wait.started": state = event.state; break; case "agent.done": case "agent.exited": state = "done"; break; default: state = "working"; }
  const agentId = "subagentId" in event ? event.subagentId : "agentId" in event && event.agentId ? event.agentId : event.sessionId;
  return Object.freeze({ provider: event.provider, state, sequence: event.sequence, agentId, source: `extension:${event.provider}` });
}
function isMappingVersion(value: string): boolean { return typeof value === "string" && value.length > 0 && value.length <= 64; }
