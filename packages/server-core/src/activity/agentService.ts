import { createAgentHookEnvironment, type AgentHookEnvironment } from "./environment.js";
import { createAgentDriverRegistry, type AgentDriverRegistry } from "./agentDrivers.js";
import { AgentStatusStore, makeAgentStatusStreamId, selectAgentStatusEntry, selectAgentStatusesForTerminal } from "./agentStore.js";
import type { AgentLifecycleEvent, AgentProvider, AgentStatusListener, AgentStatusSnapshot } from "./agentTypes.js";
import { createAgentHookReceiver, type AgentHookReceiver, type AgentHookReceiverOptions } from "./hookReceiver.js";
import type { ActivitySessionIdentity, TerminalActivityService } from "./service.js";
import type { ProviderActivityState, ProviderActivityUpdate } from "./types.js";

export interface AgentStatusServiceOptions {
  readonly activity: TerminalActivityService;
  readonly driverRegistry?: AgentDriverRegistry;
  readonly now?: () => number;
  readonly receiver?: Omit<AgentHookReceiverOptions, "service" | "normalize">;
  readonly store?: AgentStatusStore;
  /** Server-owned desired integration state. The receiver may remain bound
   * while disabled, but no lease or reduced state is retained. */
  readonly enabled?: boolean;
  /** Injectable for deterministic foreground-process lifecycle tests. */
  readonly foregroundExitConfirmationMs?: number;
}

const DEFAULT_FOREGROUND_EXIT_CONFIRMATION_MS = 500;

function providerFromForegroundProcess(processName: string): AgentProvider | null {
  const executable = processName.trim().split(/[\\/]/u).pop()?.toLowerCase() ?? "";
  if (/^codex(?:[-_.]|$)/u.test(executable)) return "codex";
  if (/^claude(?:[-_.]|$)/u.test(executable)) return "claude-code";
  return null;
}

/**
 * Server-owned provider hook and agent authority. It is intentionally scoped
 * by the same immutable terminal identity as TerminalActivityService. The
 * receiver sees native payloads only inside this process; clients receive
 * reduced lifecycle snapshots and never provider tokens or raw payloads.
 */
export class AgentStatusService {
  readonly receiver: AgentHookReceiver;
  readonly drivers: AgentDriverRegistry;
  private readonly activity: TerminalActivityService;
  private readonly now: () => number;
  private readonly store: AgentStatusStore;
  private readonly active = new Map<string, ActivitySessionIdentity>();
  /** Retain immutable terminal scope after exit so historic agent entries can
   * still be filtered before they cross an authenticated transport. */
  private readonly sessionScopes = new Map<string, ActivitySessionIdentity>();
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
    this.now = options.now ?? Date.now;
    this.store = options.store ?? new AgentStatusStore();
    this.enabled = options.enabled ?? true;
    this.foregroundExitConfirmationMs = Math.max(0, options.foregroundExitConfirmationMs ?? DEFAULT_FOREGROUND_EXIT_CONFIRMATION_MS);
    this.receiver = createAgentHookReceiver({
      ...(options.receiver ?? {}),
      service: options.activity,
      normalize: (payload, context) => this.normalizeHook(context.provider, context.identity, payload),
    });
  }

  getSnapshot(): AgentStatusSnapshot { return this.store.getSnapshot(); }
  /** Whether this exact immutable terminal scope can still act on or expose
   * live agent state. Compatibility adapters must not treat a recycled
   * session id, an exited session, or a different project as equivalent. */
  isSessionActive(identity: ActivitySessionIdentity): boolean {
    const current = this.active.get(identity.sessionId);
    return current !== undefined &&
      current.serverId === identity.serverId &&
      current.projectId === identity.projectId &&
      current.sessionId === identity.sessionId;
  }
  getSnapshotForProject(projectId: string | undefined): AgentStatusSnapshot {
    return this.filterSnapshotForProject(this.store.getSnapshot(), projectId);
  }
  filterSnapshotForProject(snapshot: AgentStatusSnapshot, projectId: string | undefined): AgentStatusSnapshot {
    if (projectId === undefined) return snapshot;
    const entries = Object.fromEntries(Object.entries(snapshot.entries).filter(([, entry]) => this.sessionScopes.get(entry.activationTerminalSessionId)?.projectId === projectId));
    return Object.freeze({ ...snapshot, entries: Object.freeze(entries) });
  }
  subscribe(listener: AgentStatusListener): () => void { return this.store.subscribe(listener); }
  get endpoint(): string { return this.receiver.endpoint; }
  get listening(): boolean { return this.receiver.listening; }
  get serverId(): string { return this.activity.serverId; }
  get integrationEnabled(): boolean { return this.enabled; }

  async start(): Promise<void> {
    if (this.started) return;
    await this.receiver.start();
    this.started = true;
  }

  async stop(): Promise<void> {
    for (const identity of [...this.active.values()]) this.terminalExited(identity);
    this.active.clear();
    this.sessionScopes.clear();
    this.sequences.clear();
    this.clearForegroundTracking();
    this.pendingSubagentLaunches.clear();
    this.started = false;
    await this.receiver.stop();
  }

  /** Apply the committed server setting without stopping the loopback
   * receiver. Disabling revokes every lease and clears canonical state so a
   * later enable can issue only fresh credentials. */
  setIntegrationEnabled(enabled: boolean): boolean {
    if (typeof enabled !== "boolean") throw new TypeError("agent integration enabled must be boolean");
    if (this.enabled === enabled) return false;
    this.enabled = enabled;
    if (!enabled) {
      for (const identity of this.active.values()) this.receiver.revoke(identity, { exit: false });
      this.active.clear();
      this.sessionScopes.clear();
      this.sequences.clear();
      this.clearForegroundTracking();
      this.pendingSubagentLaunches.clear();
      this.store.clear();
    }
    return true;
  }

  /** Register a terminal and return only the three environment values needed by its child provider. */
  prepareTerminalSession(identity: ActivitySessionIdentity): AgentHookEnvironment | Readonly<Record<string, never>> {
    if (!this.started) throw new Error("agent status service is not running");
    if (!this.enabled) return Object.freeze({});
    const lease = this.receiver.register(identity);
    this.active.set(identity.sessionId, Object.freeze({ ...identity }));
    this.sessionScopes.set(identity.sessionId, Object.freeze({ ...identity }));
    return createAgentHookEnvironment(identity.sessionId, this.receiver.endpoint, lease.token);
  }

  register(identity: ActivitySessionIdentity): void {
    if (!this.enabled) return;
    this.receiver.register(identity);
    this.active.set(identity.sessionId, Object.freeze({ ...identity }));
    this.sessionScopes.set(identity.sessionId, Object.freeze({ ...identity }));
  }

  terminalExited(identity: ActivitySessionIdentity, options: { readonly exitCode?: number; readonly signal?: string } = {}): void {
    const current = this.active.get(identity.sessionId);
    if (!current || current.projectId !== identity.projectId || current.serverId !== identity.serverId) return;
    this.active.delete(identity.sessionId);
    this.sequencesFor(identity.sessionId);
    this.removePendingSubagentLaunches(identity.sessionId);
    this.clearForegroundTrackingForSession(identity.sessionId);
    this.receiver.revoke(identity, { exit: true });
    const entries = selectAgentStatusesForTerminal(this.store.getSnapshot(), identity.sessionId).filter((entry) => entry.active);
    let exitSequence = Math.max(0, ...entries.map((entry) => entry.lastEventSequence)) + 1;
    for (const entry of entries) {
      this.store.dispatch({
        provider: entry.provider,
        sessionId: entry.sessionId,
        activationTerminalSessionId: identity.sessionId,
        agentId: entry.agentId,
        kind: "agent.exited",
        sequence: exitSequence++,
        occurredAt: Math.max(this.now(), entry.updatedAt),
        ...(options.exitCode === undefined ? {} : { exitCode: options.exitCode }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    }
  }

  abandonTerminalSession(identity: ActivitySessionIdentity): void {
    const current = this.active.get(identity.sessionId);
    if (!current || current.projectId !== identity.projectId || current.serverId !== identity.serverId) return;
    this.active.delete(identity.sessionId);
    this.sequencesFor(identity.sessionId);
    this.removePendingSubagentLaunches(identity.sessionId);
    this.clearForegroundTrackingForSession(identity.sessionId);
    this.receiver.revoke(identity, { exit: false });
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

  /** Direct server-side ingestion is useful to PTY adapters and bounded fixtures; HTTP hooks use the same normalizer. */
  async ingestHookPayload(identity: ActivitySessionIdentity, provider: AgentProvider, payload: Readonly<Record<string, unknown>>): Promise<boolean> {
    this.assertActive(identity);
    const update = await this.normalizeHook(provider, identity, payload);
    if (update === null) return false;
    this.activity.ingestProvider(identity, update);
    return true;
  }

  private async normalizeHook(provider: string, identity: ActivitySessionIdentity, payload: Readonly<Record<string, unknown>>): Promise<ProviderActivityUpdate | null> {
    this.assertActive(identity);
    const sequence = this.nextSequence(provider, identity.sessionId);
    const event = await this.drivers.normalizeAsync(provider, payload, {
      activationTerminalSessionId: identity.sessionId,
      sequence,
      occurredAt: this.now(),
      providerSessionId: typeof payload.session_id === "string" ? payload.session_id : typeof payload.sessionId === "string" ? payload.sessionId : undefined,
    });
    if (event === null) return null;
    validateLifecycleEvent(event, provider, identity.sessionId);
    // A provider hook is stronger evidence than the weak foreground-process
    // observation. In particular, it proves the provider is still live when
    // a shell-return confirmation timer is pending, so it must prevent that
    // timer from retiring the canonical association.
    this.foregroundProviderBySession.set(identity.sessionId, event.provider);
    this.cancelPendingForegroundExit(identity.sessionId);
    const correlated = this.correlateSubagentLaunch(event);
    this.store.dispatch(correlated);
    return toProviderUpdate(correlated);
  }

  /** Retire a provider after a confirmed return to the shell when its hooks
   * did not emit a terminal event. This is host input, never renderer state. */
  foregroundProcessChanged(identity: ActivitySessionIdentity, processName: string, shellForeground: boolean): void {
    if (!this.active.has(identity.sessionId)) return;
    const provider = providerFromForegroundProcess(processName);
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
    if (!current || current.serverId !== identity.serverId || current.projectId !== identity.projectId) throw new Error("agent hook session is not active for this project");
  }

  private nextSequence(provider: string, sessionId: string, minimum?: number): number {
    const providerSequences = this.sequences.get(sessionId) ?? new Map<string, number>();
    this.sequences.set(sessionId, providerSequences);
    const next = Math.max(providerSequences.get(provider) ?? 1, minimum ?? 1);
    providerSequences.set(provider, next + 1);
    return next;
  }

  private sequencesFor(sessionId: string): void {
    this.sequences.delete(sessionId);
  }

  private correlateSubagentLaunch(event: AgentLifecycleEvent): AgentLifecycleEvent {
    const streamId = makeAgentStatusStreamId(event.provider, event.activationTerminalSessionId, event.sessionId);
    if (event.kind === "tool.started" && event.tool.subagentLaunch !== undefined) {
      const pending = this.pendingSubagentLaunches.get(streamId) ?? [];
      this.pendingSubagentLaunches.set(streamId, [...pending, { ...event.tool.subagentLaunch, toolId: event.tool.id }].slice(-32));
      return event;
    }
    if (event.kind === "tool.finished") {
      const pending = this.pendingSubagentLaunches.get(streamId);
      if (pending !== undefined) {
        const next = pending.filter((candidate) => candidate.toolId !== event.toolId);
        if (next.length === 0) this.pendingSubagentLaunches.delete(streamId);
        else this.pendingSubagentLaunches.set(streamId, next);
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
    for (const [streamId] of this.pendingSubagentLaunches) {
      if (streamId.split(":").some((part) => decodeURIComponent(part) === sessionId)) this.pendingSubagentLaunches.delete(streamId);
    }
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

  private cancelPendingForegroundExit(sessionId: string): void {
    const timer = this.pendingForegroundExits.get(sessionId);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.pendingForegroundExits.delete(sessionId);
  }

  private clearForegroundTrackingForSession(sessionId: string): void {
    this.cancelPendingForegroundExit(sessionId);
    this.foregroundProviderBySession.delete(sessionId);
  }

  private clearForegroundTracking(): void {
    for (const sessionId of this.pendingForegroundExits.keys()) this.cancelPendingForegroundExit(sessionId);
    this.foregroundProviderBySession.clear();
  }
}

function toProviderUpdate(event: AgentLifecycleEvent): ProviderActivityUpdate {
  let state: ProviderActivityState;
  switch (event.kind) {
    case "session.started":
    case "session.stopped": state = "idle"; break;
    case "wait.started": state = event.state; break;
    case "agent.done":
    case "agent.exited": state = "done"; break;
    default: state = "working";
  }
  const agentId = "subagentId" in event ? event.subagentId : "agentId" in event && event.agentId ? event.agentId : event.sessionId;
  return Object.freeze({ provider: event.provider, state, sequence: event.sequence, agentId, source: `hook:${event.provider}` });
}

function validateLifecycleEvent(event: AgentLifecycleEvent, provider: string, terminalSessionId: string): void {
  if (!event || typeof event !== "object" || event.provider !== provider || event.activationTerminalSessionId !== terminalSessionId) throw new Error("agent driver returned an invalid scope");
  if (typeof event.sessionId !== "string" || event.sessionId.length === 0 || event.sessionId.length > 512) throw new Error("agent driver returned an invalid provider session");
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 0 || !Number.isFinite(event.occurredAt)) throw new Error("agent driver returned invalid ordering metadata");
  if ("agentId" in event && event.agentId !== undefined && (typeof event.agentId !== "string" || event.agentId.length === 0 || event.agentId.length > 512)) throw new Error("agent driver returned an invalid agent id");
  if ("subagentId" in event && (typeof event.subagentId !== "string" || event.subagentId.length === 0 || event.subagentId.length > 512)) throw new Error("agent driver returned an invalid subagent id");
  if (event.promptText !== undefined && event.promptText.length > 4_000) throw new Error("agent driver returned an oversized prompt");
}
