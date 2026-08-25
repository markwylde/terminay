import { randomBytes } from "node:crypto";
import type { AgentProviderContribution } from "@terminay/extension-api";
import { THIS_SERVER_ENVIRONMENT_ID } from "../workspace.js";
import type { ProjectEnvironmentBinding, ProjectEnvironmentRouter } from "../projectEnvironment/router.js";
import type { ExtensionHostManager } from "../extensions/manager.js";
import type { ExtensionAgentTerminalCancellationReason } from "../extensions/types.js";
import type { ExtensionAgentTerminalContext } from "../extensions/types.js";
import type { ThisServerAgentTerminal } from "../extensions/localAgentObservation.js";
import type { ActivitySessionIdentity } from "./service.js";
import { AgentStatusService } from "./agentService.js";

/** Bounded, metadata-only evidence that a matched provider could not begin
 * observing a terminal. Hosts can send this to their local diagnostics sink;
 * raw extension errors and provider data deliberately stay private. */
export interface ExtensionAgentAdmissionFailure {
  readonly kind: "agent-admission-failed";
  readonly providerId: string;
  readonly terminal: Readonly<ActivitySessionIdentity>;
  readonly failureClass: "cancelled" | "invalid" | "timed-out" | "unavailable" | "host-failed" | "failed";
  /** Host-local stderr diagnostic. Not a provider payload. */
  readonly reason?: string;
}

export interface ExtensionAgentRuntimeRegistryOptions {
  /** The selected server's live extension hosts. Contributions are read only
   * while the host is running; admission still validates ownership in the
   * manager to close an activation/disable race. */
  readonly hosts: Pick<ExtensionHostManager, "agentProviderContributions" | "admitAgentTerminal" | "cancelAgentTerminal" | "drainAgentObservers">;
  readonly agents: AgentStatusService;
  /** The canonical router supplies the immutable environment binding. Local
   * observation is admitted only for This Server until a remote environment
   * contributes a corresponding observation adapter. */
  readonly projectEnvironmentRouter?: ProjectEnvironmentRouter;
  readonly localObservationCapabilities?: readonly string[];
  readonly platform?: "darwin" | "linux" | "win32";
  readonly contextId?: (identity: ActivitySessionIdentity, incarnation: number) => string;
  /** A best-effort, metadata-only telemetry hook. A diagnostic sink is never
   * allowed to change terminal ownership or fallback behaviour. */
  readonly onAdmissionFailure?: (failure: ExtensionAgentAdmissionFailure) => void;
  readonly reobserveDebounceMs?: number;
  /** Host-private, terminal-scoped topology probe. It may inspect only the
   * admitted terminal's descendants/open-file identity and must not expose
   * paths or process data to an extension. */
  readonly topologySignature?: (context: ExtensionAgentTerminalContext, signal: AbortSignal) => Promise<string | undefined>;
  readonly topologyPollIntervalMs?: number;
  readonly schedule?: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  readonly cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
}

interface TrackedTerminal {
  readonly identity: ActivitySessionIdentity;
  shellPid?: number;
  incarnation: number;
  notBoundRetries: number;
  context?: ExtensionAgentTerminalContext;
  lastProcessName?: string;
  pendingReobserve?: { readonly contribution: AgentProviderContribution; readonly processName: string };
  reobserveTimer?: ReturnType<typeof setTimeout>;
  topologyTimer?: ReturnType<typeof setTimeout>;
  topologySignature?: string;
  topologyPolling?: boolean;
  /** After the fast not-bound window, topology polling must keep trying until
   * a journal is proven or the shell returns. The first sample after
   * exhaustion may be the first one that can see the provider's journal. */
  unboundTopologyReobserve?: boolean;
  environmentBinding?: ProjectEnvironmentBinding;
}

const LOCAL_CAPABILITIES = Object.freeze(["process-observation", "filesystem-observation", "agent-journal"]);
const MAX_NOT_BOUND_DISCOVERY_RETRIES = 10;

/**
 * Server-side admission authority for manifest-declared agent providers.
 *
 * Process matching is merely a prompt to attempt provider observation. The
 * provider is made authoritative only after `AgentStatusService` records an
 * exact terminal claim, then receives a host-issued incarnation context. A
 * failed admission releases that claim and returns the legacy journal path to
 * service, preserving current behaviour during the migration.
 */
export class ExtensionAgentRuntimeRegistry {
  private readonly terminals = new Map<string, TrackedTerminal>();
  private readonly localObservationCapabilities: readonly string[];
  private readonly platform: "darwin" | "linux" | "win32";
  private readonly makeContextId: NonNullable<ExtensionAgentRuntimeRegistryOptions["contextId"]>;
  private readonly reobserveDebounceMs: number;
  private readonly topologyPollIntervalMs: number;
  private readonly schedule: NonNullable<ExtensionAgentRuntimeRegistryOptions["schedule"]>;
  private readonly cancelSchedule: NonNullable<ExtensionAgentRuntimeRegistryOptions["cancelSchedule"]>;

  constructor(private readonly options: ExtensionAgentRuntimeRegistryOptions) {
    this.localObservationCapabilities = Object.freeze([...(options.localObservationCapabilities ?? LOCAL_CAPABILITIES)]);
    this.platform = options.platform ?? platformName();
    // Context ids are opaque, live authority capabilities—not a derivation of
    // user-restorable project/session labels. A fresh registry nonce prevents
    // two simultaneous server processes with identical persisted labels from
    // ever minting the same extension-host handle.
    const authorityNonce = randomBytes(18).toString("base64url");
    this.makeContextId = options.contextId ?? ((_identity, incarnation) =>
      `extension-agent:${authorityNonce}:${incarnation}`);
    this.reobserveDebounceMs = Math.max(0, options.reobserveDebounceMs ?? 100);
    this.topologyPollIntervalMs = Math.max(100, options.topologyPollIntervalMs ?? 1_500);
    this.schedule = options.schedule ?? ((callback, milliseconds) => setTimeout(callback, milliseconds));
    this.cancelSchedule = options.cancelSchedule ?? ((timer) => clearTimeout(timer));
  }

  register(identity: ActivitySessionIdentity): void {
    const current = this.terminals.get(identity.sessionId);
    if (current !== undefined && sameIdentity(current.identity, identity)) return;
    this.terminals.set(identity.sessionId, { identity: Object.freeze({ ...identity }), incarnation: (current?.incarnation ?? 0) + 1, notBoundRetries: 0, environmentBinding: this.bindEnvironment(identity) });
  }

  terminalStarted(identity: ActivitySessionIdentity, shellPid: number): void {
    const terminal = this.requireTerminal(identity);
    terminal.shellPid = shellPid;
  }

  /** Claims a matching local terminal synchronously, then performs the child
   * IPC admission in the background. Returning true means legacy foreground
   * and journal mutations are now suppressed by AgentStatusService. */
  foregroundProcessChanged(identity: ActivitySessionIdentity, processName: string, shellForeground = false): boolean {
    const terminal = this.requireTerminal(identity);
    if (terminal.environmentBinding === undefined) terminal.environmentBinding = this.bindEnvironment(identity);
    terminal.lastProcessName = processName;
    // A provider journal may be shared by a later `resume` in another
    // Terminay authority.  Once this exact PTY returns to its shell, its
    // descendant proof has ended and its observer must be revoked immediately;
    // otherwise the old child can keep following the global provider journal
    // and project a subsequent writer's events into this terminal.
    if (shellForeground) {
      const previous = terminal.context;
      if (previous === undefined) return false;
      this.clearTimers(terminal);
      terminal.context = undefined;
      terminal.incarnation += 1;
      terminal.notBoundRetries = 0;
      terminal.unboundTopologyReobserve = false;
      try { this.options.agents.releaseExtensionProvider(terminal.identity, previous.providerId); }
      catch { /* terminal exit/replacement can race foreground observation */ }
      void this.options.hosts.cancelAgentTerminal({ contextId: previous.contextId, reason: "terminal-replaced" }).catch(() => undefined);
      return false;
    }
    const queue = this.discoveryQueue(processName, identity);
    if (terminal.context !== undefined) {
      // A TUI can alternate between its launcher, runtime, and helper process
      // names while the same PTY-owned journal writer remains live. A proven
      // binding must outlive those generic samples; otherwise each sample
      // cancels the watcher before it can publish its initial session record.
      // A different explicitly matched provider is a genuine replacement.
      // Process-topology changes from collaboration workers keep the proven
      // root observer alive; their native journals are discovered beneath it.
      const matched = this.match(processName, identity);
      if (matched === undefined) return true;
      if (matched.id === terminal.context.providerId) {
        // The shell edge between a short-lived CLI session and `codex resume`
        // can be missed by process sampling. Preserve a live root (including
        // collaboration topology), but re-admit the same provider once its
        // canonical root has exited so the resumed writer can bind again.
        const activeRoot = Object.values(this.options.agents.getSnapshot().entries).some((entry) =>
          entry.kind === "root"
          && entry.provider === matched.id
          && entry.activationTerminalSessionId === terminal.identity.sessionId
          && entry.active,
        );
        if (!activeRoot) this.scheduleReobserve(terminal, matched, processName);
        return true;
      }
      this.scheduleReobserve(terminal, matched, processName);
      return true;
    }
    if (queue[0] === undefined) return false;
    return this.claimAndAdmit(terminal, queue[0], processName);
  }

  /** Re-evaluate the last host-observed foreground process for every live
   * terminal. The extension manager calls this after atomically publishing a
   * new provider inventory, so a late-installed agent can bind an already
   * running CLI without requiring a new terminal event or restart. */
  reobserveExistingTerminals(): number {
    let admitted = 0;
    for (const terminal of this.terminals.values()) {
      if (terminal.context !== undefined || terminal.lastProcessName === undefined) continue;
      const contribution = this.discoveryQueue(terminal.lastProcessName, terminal.identity)[0];
      if (contribution !== undefined && this.claimAndAdmit(terminal, contribution, terminal.lastProcessName)) admitted += 1;
    }
    return admitted;
  }

  /** Remove terminal claims owned by providers which are no longer published.
   * A disabled extension host drains its child observer, but the registry
   * retains the terminal's last foreground sample so that enabling the same
   * provider can immediately admit it again. Without this reconciliation the
   * stale claim makes `reobserveExistingTerminals` skip that terminal until a
   * full server restart reconstructs the registry. */
  async reconcileProviderInventory(): Promise<number> {
    const available = new Set(this.options.hosts.agentProviderContributions().map((provider) => provider.id));
    let retired = 0;
    for (const terminal of this.terminals.values()) {
      const context = terminal.context;
      if (context === undefined || available.has(context.providerId)) continue;
      this.clearTimers(terminal);
      await this.options.hosts.cancelAgentTerminal({ contextId: context.contextId, reason: "provider-disabled" }).catch(() => undefined);
      if (terminal.context !== context) continue;
      terminal.context = undefined;
      terminal.incarnation += 1;
      terminal.notBoundRetries = 0;
      terminal.unboundTopologyReobserve = false;
      try { this.options.agents.releaseExtensionProvider(terminal.identity, context.providerId); }
      catch { /* terminal lifecycle can race provider publication */ }
      retired += 1;
    }
    return retired;
  }

  /** A host process/open-file watcher can call this when a still-matching
   * terminal topology changes. Debouncing prevents a burst of native process
   * events from creating overlapping child observers. */
  topologyChanged(identity: ActivitySessionIdentity): void {
    const terminal = this.terminals.get(identity.sessionId);
    if (terminal?.context === undefined || !sameIdentity(terminal.identity, identity)) return;
    // A collaboration worker is a new descendant and can hold its own native
    // journal. That is ordinary activity inside the already-proven root PTY,
    // not evidence that its root writer was replaced. Re-admitting here
    // cancels the root stream just as its subagent events arrive. Explicit
    // foreground replacement and shell return retain the authority to retire
    // a bound context; topology polling remains the recovery path only until
    // a provider has actually bound.
    if (terminal.unboundTopologyReobserve !== true) return;
    const queue = this.discoveryQueue(terminal.lastProcessName ?? "", terminal.identity);
    const contribution = queue.find((provider) => provider.id === terminal.context!.providerId)
      ?? queue[0]
      ?? this.options.hosts.agentProviderContributions().find((value) => value.id === terminal.context!.providerId);
    if (contribution !== undefined) this.scheduleReobserve(terminal, contribution, terminal.lastProcessName ?? "");
  }

  private claimAndAdmit(terminal: TrackedTerminal, contribution: AgentProviderContribution, processName: string): boolean {
    const identity = terminal.identity;
    if (contribution === undefined || !this.options.agents.claimExtensionProvider(identity, contribution.id)) return false;
    const context: ExtensionAgentTerminalContext = Object.freeze({
      contextId: this.makeContextId(identity, terminal.incarnation),
      serverId: identity.serverId,
      projectId: identity.projectId,
      projectEnvironmentId: this.projectEnvironmentId(identity),
      terminalSessionId: identity.sessionId,
      terminalIncarnationId: String(terminal.incarnation),
      providerId: contribution.id,
      ...(terminal.shellPid === undefined ? {} : { shellPid: terminal.shellPid }),
    });
    terminal.context = context;
    terminal.lastProcessName = processName;
    const observationCapabilities = context.projectEnvironmentId === THIS_SERVER_ENVIRONMENT_ID
      ? contribution.requiredEnvironmentCapabilities.filter((capability) => this.localObservationCapabilities.includes(capability))
      : contribution.requiredEnvironmentCapabilities;
    void this.options.hosts.admitAgentTerminal({ context, observationCapabilities }).then((result) => {
      if (terminal.context !== context) return;
      if (admissionState(result) === "not-bound") {
        const next = this.nextDiscoveryProvider(terminal, contribution, processName);
        if (next !== undefined && next.id !== contribution.id) {
          this.scheduleReobserve(terminal, next, processName);
          return;
        }
        this.scheduleDiscoveryRetry(
          terminal,
          this.discoveryQueue(processName, terminal.identity)[0] ?? contribution,
          processName,
        );
        return;
      }
      terminal.notBoundRetries = 0;
      terminal.unboundTopologyReobserve = false;
      // A generic wrapper can have queued a fallback before its eventual
      // provider opened the journal. Once that provider proves its binding,
      // discard the stale fallback: otherwise it can retire the new observer
      // while its first JSONL chunk is still being read.
      this.clearReobserve(terminal);
      this.scheduleTopologyPoll(terminal);
    }).catch((error: unknown) => {
      // Observation can throw before the journal is visible (IPC that cannot
      // clone AbortSignal, missing shell pid, lsof races). Keep the claim on
      // this PTY and retry the same way as `not-bound`; releasing here left
      // a running agent with an empty Agents pane. An unmatched wrapper must
      // still walk the queue: one failed observation cannot pin discovery
      // away from a later provider that can bind.
      if (terminal.context !== context) return;
      this.reportAdmissionFailure(identity, contribution.id, error);
      const next = this.nextDiscoveryProvider(terminal, contribution, processName);
      if (next !== undefined && next.id !== contribution.id) {
        this.scheduleReobserve(terminal, next, processName);
        return;
      }
      this.scheduleDiscoveryRetry(terminal, contribution, processName);
    });
    return true;
  }

  private scheduleReobserve(terminal: TrackedTerminal, contribution: AgentProviderContribution, processName: string): void {
    terminal.pendingReobserve = { contribution, processName };
    if (terminal.reobserveTimer !== undefined) return;
    terminal.reobserveTimer = this.schedule(() => {
      terminal.reobserveTimer = undefined;
      const pending = terminal.pendingReobserve;
      terminal.pendingReobserve = undefined;
      if (pending !== undefined) void this.reobserve(terminal, pending.contribution, pending.processName);
    }, this.reobserveDebounceMs);
  }

  /** A provider may receive the foreground edge before its process/journal is
   * visible. Keep the claim scoped to that PTY and retry only a short bounded
   * window; a shell edge, replacement, or teardown clears this timer. */
  private scheduleDiscoveryRetry(terminal: TrackedTerminal, contribution: AgentProviderContribution, processName: string): void {
    if (terminal.notBoundRetries >= MAX_NOT_BOUND_DISCOVERY_RETRIES) {
      terminal.unboundTopologyReobserve = true;
      this.scheduleTopologyPoll(terminal);
      return;
    }
    terminal.notBoundRetries += 1;
    // A matched provider stays put. Unmatched wrappers rotate in
    // `claimAndAdmit` before this retry wraps the queue.
    this.scheduleReobserve(terminal, contribution, processName);
  }

  private async reobserve(terminal: TrackedTerminal, contribution: AgentProviderContribution, processName: string): Promise<void> {
    const previous = terminal.context;
    if (previous === undefined) {
      this.claimAndAdmit(terminal, contribution, processName);
      return;
    }
    await this.options.hosts.cancelAgentTerminal({ contextId: previous.contextId, reason: "terminal-replaced" }).catch(() => undefined);
    if (terminal.context !== previous && terminal.context !== undefined) return;
    if (terminal.context === previous) {
      terminal.context = undefined;
      try { this.options.agents.releaseExtensionProvider(terminal.identity, previous.providerId); }
      catch { return; }
    }
    terminal.incarnation += 1;
    this.claimAndAdmit(terminal, contribution, processName);
  }

  terminalExited(identity: ActivitySessionIdentity, reason: ExtensionAgentTerminalCancellationReason = "terminal-closed"): void {
    const terminal = this.terminals.get(identity.sessionId);
    if (terminal === undefined || !sameIdentity(terminal.identity, identity)) return;
    this.terminals.delete(identity.sessionId);
    this.clearTimers(terminal);
    if (terminal.context !== undefined) {
      void this.options.hosts.cancelAgentTerminal({ contextId: terminal.context.contextId, reason }).catch(() => undefined);
    }
  }

  async drain(reason: "provider-disabled" | "extension-stopped" | "server-stopping" = "server-stopping"): Promise<void> {
    if (this.terminals.size === 0) return;
    for (const terminal of this.terminals.values()) this.clearTimers(terminal);
    this.terminals.clear();
    await this.options.hosts.drainAgentObservers(reason);
  }

  /** Retire only contexts owned by a disabled/crashed provider. Other agent
   * extensions continue observing their terminals. */
  async retireProvider(providerId: string, reason: "provider-disabled" | "extension-stopped" = "provider-disabled"): Promise<number> {
    const retiring = [...this.terminals.values()].filter((terminal) => terminal.context?.providerId === providerId);
    for (const terminal of retiring) {
      this.clearTimers(terminal);
      const context = terminal.context!;
      await this.options.hosts.cancelAgentTerminal({ contextId: context.contextId, reason }).catch(() => undefined);
      if (terminal.context === context) {
        terminal.context = undefined;
        try { this.options.agents.releaseExtensionProvider(terminal.identity, providerId); } catch { /* already torn down */ }
      }
    }
    return retiring.length;
  }

  /** Mirror a host-originated retirement (provider disposal or child crash)
   * without sending cancellation back into the already-retired host. */
  contextRetired(contextId: string, providerId: string): boolean {
    const terminal = [...this.terminals.values()].find((candidate) => candidate.context?.contextId === contextId && candidate.context.providerId === providerId);
    if (terminal?.context === undefined) return false;
    this.clearTimers(terminal); terminal.context = undefined;
    try { this.options.agents.releaseExtensionProvider(terminal.identity, providerId); } catch { /* teardown is idempotent */ }
    return true;
  }

  /** Environment revisions are immutable terminal bindings. A revision change
   * invalidates the old observer instead of silently following the project. */
  environmentRevisionChanged(projectId: string): void {
    for (const terminal of [...this.terminals.values()]) if (terminal.identity.projectId === projectId) this.terminalExited(terminal.identity, "terminal-replaced");
  }

  projectRemoved(projectId: string): void {
    for (const terminal of [...this.terminals.values()]) if (terminal.identity.projectId === projectId) this.terminalExited(terminal.identity, "terminal-closed");
  }

  environmentBinding(context: ExtensionAgentTerminalContext): ProjectEnvironmentBinding | undefined {
    const terminal = this.terminals.get(context.terminalSessionId);
    return terminal?.context?.contextId === context.contextId ? terminal.environmentBinding : undefined;
  }

  /** Resolve only a currently admitted, exact terminal context for the local
   * observation adapter. The extension never calls this directly. */
  observationTerminal(context: ExtensionAgentTerminalContext): ThisServerAgentTerminal | undefined {
    const terminal = this.terminals.get(context.terminalSessionId);
    if (terminal?.context === undefined || terminal.context.contextId !== context.contextId
      || terminal.context.terminalIncarnationId !== context.terminalIncarnationId
      || terminal.identity.serverId !== context.serverId
      || terminal.identity.projectId !== context.projectId) return undefined;
    return Object.freeze({
      environment: context.projectEnvironmentId === THIS_SERVER_ENVIRONMENT_ID ? "this-server" : "remote",
      ...(terminal.shellPid === undefined ? {} : { shellPid: terminal.shellPid }),
    });
  }

  private requireTerminal(identity: ActivitySessionIdentity): TrackedTerminal {
    const terminal = this.terminals.get(identity.sessionId);
    if (terminal !== undefined && sameIdentity(terminal.identity, identity)) return terminal;
    const created: TrackedTerminal = { identity: Object.freeze({ ...identity }), incarnation: 1, notBoundRetries: 0, environmentBinding: this.bindEnvironment(identity) };
    this.terminals.set(identity.sessionId, created);
    return created;
  }

  private scheduleTopologyPoll(terminal: TrackedTerminal): void {
    if (this.options.topologySignature === undefined || terminal.topologyTimer !== undefined || terminal.context === undefined) return;
    terminal.topologyTimer = this.schedule(() => {
      terminal.topologyTimer = undefined;
      void this.pollTopology(terminal);
    }, this.topologyPollIntervalMs);
  }

  private async pollTopology(terminal: TrackedTerminal): Promise<void> {
    const context = terminal.context;
    if (context === undefined || terminal.topologyPolling || this.options.topologySignature === undefined) return;
    terminal.topologyPolling = true;
    const controller = new AbortController();
    try {
      const signature = await this.options.topologySignature(context, controller.signal);
      if (terminal.context !== context || signature === undefined) return;
      const changed = terminal.topologySignature !== undefined && terminal.topologySignature !== signature;
      const retryUnbound = terminal.unboundTopologyReobserve === true;
      terminal.topologySignature = signature;
      if (changed || retryUnbound) {
        this.topologyChanged(terminal.identity);
        // `topologyChanged` needs this fact to admit the late unbound writer;
        // clear it only after scheduling that one recovery attempt.
        terminal.unboundTopologyReobserve = false;
      }
    } catch { /* unavailable local/remote topology remains non-authoritative */ }
    finally {
      terminal.topologyPolling = false;
      if (terminal.context === context) this.scheduleTopologyPoll(terminal);
    }
  }

  private clearTimers(terminal: TrackedTerminal): void {
    this.clearReobserve(terminal);
    if (terminal.topologyTimer !== undefined) this.cancelSchedule(terminal.topologyTimer);
    terminal.topologyTimer = undefined;
  }

  private clearReobserve(terminal: TrackedTerminal): void {
    if (terminal.reobserveTimer !== undefined) this.cancelSchedule(terminal.reobserveTimer);
    terminal.reobserveTimer = undefined;
    terminal.pendingReobserve = undefined;
  }

  private match(processName: string, identity: ActivitySessionIdentity): AgentProviderContribution | undefined {
    const executable = executableName(processName);
    if (executable.length === 0) return undefined;
    return this.capableProviders(identity).find((provider) =>
      provider.processMatchers?.some((matcher) => matcher.arguments === undefined && matchesExecutable(matcher.executableName, executable)) === true,
    );
  }

  /** Exact/prefix matcher first. An unmatched wrapper must try every capable
   * provider, rather than selecting only the first contribution and missing a
   * later provider that can prove its journal binding. An empty name is not a
   * leave-shell edge. */
  private discoveryQueue(processName: string, identity: ActivitySessionIdentity): AgentProviderContribution[] {
    if (executableName(processName).length === 0) return [];
    const matched = this.match(processName, identity);
    return matched === undefined ? this.capableProviders(identity) : [matched];
  }

  private nextDiscoveryProvider(
    terminal: TrackedTerminal,
    current: AgentProviderContribution,
    processName: string,
  ): AgentProviderContribution | undefined {
    const queue = this.discoveryQueue(processName, terminal.identity);
    if (queue.length === 0) return undefined;
    const index = queue.findIndex((provider) => provider.id === current.id);
    // A generic wrapper (such as a Node CLI shim) has no provider identity.
    // Cycle its capable providers until one can prove its writer-bound
    // journal; stopping on the final provider made a delayed rollout
    // permanently undiscoverable after the first pass.
    return index >= 0 ? queue[(index + 1) % queue.length] : queue[0];
  }

  private capableProviders(identity: ActivitySessionIdentity): AgentProviderContribution[] {
    const tracked = this.terminals.get(identity.sessionId);
    if (this.options.projectEnvironmentRouter !== undefined && tracked?.environmentBinding === undefined) return [];
    return this.options.hosts.agentProviderContributions().filter((provider) =>
      (provider.platforms === undefined || provider.platforms.includes(this.platform))
      && (this.projectEnvironmentId(identity) !== THIS_SERVER_ENVIRONMENT_ID || requiredCapabilitiesAvailable(provider, this.localObservationCapabilities)),
    );
  }

  private projectEnvironmentId(identity: ActivitySessionIdentity): string {
    try { return this.terminals.get(identity.sessionId)?.environmentBinding?.projectEnvironmentId ?? this.options.projectEnvironmentRouter?.bindProject(identity.projectId).projectEnvironmentId ?? THIS_SERVER_ENVIRONMENT_ID; }
    catch { return "terminay:environment-unavailable"; }
  }
  private bindEnvironment(identity: ActivitySessionIdentity): ProjectEnvironmentBinding | undefined {
    try { return this.options.projectEnvironmentRouter?.bindProject(identity.projectId); } catch { return undefined; }
  }

  private reportAdmissionFailure(identity: ActivitySessionIdentity, providerId: string, error: unknown): void {
    const failure: ExtensionAgentAdmissionFailure = Object.freeze({
      kind: "agent-admission-failed",
      providerId: providerId.slice(0, 256),
      terminal: Object.freeze({
        serverId: identity.serverId.slice(0, 256),
        projectId: identity.projectId.slice(0, 256),
        sessionId: identity.sessionId.slice(0, 256),
      }),
      failureClass: classifyAdmissionFailure(error),
      ...(admissionReason(error) === undefined ? {} : { reason: admissionReason(error) }),
    });
    try { this.options.onAdmissionFailure?.(failure); } catch { /* diagnostics are best effort */ }
  }
}

function requiredCapabilitiesAvailable(provider: AgentProviderContribution, available: readonly string[]): boolean {
  return provider.requiredEnvironmentCapabilities.every((capability) => available.includes(capability));
}
function executableName(value: string): string { return value.trim().split(/[\\/]/u).pop()?.toLowerCase() ?? ""; }
function matchesExecutable(matcher: string, executable: string): boolean {
  const expected = matcher.trim().toLowerCase();
  if (expected.length === 0 || executable.length === 0) return false;
  return executable === expected || executable.startsWith(`${expected}-`)
    || executable.startsWith(`${expected}_`) || executable.startsWith(`${expected}.`);
}
function sameIdentity(left: ActivitySessionIdentity, right: ActivitySessionIdentity): boolean { return left.serverId === right.serverId && left.projectId === right.projectId && left.sessionId === right.sessionId; }
function platformName(): "darwin" | "linux" | "win32" { return process.platform === "darwin" || process.platform === "win32" ? process.platform : "linux"; }
function admissionReason(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const reason = message.replace(/[\r\n]/gu, " ").trim().slice(0, 300);
  return reason.length > 0 ? reason : undefined;
}
function classifyAdmissionFailure(error: unknown): ExtensionAgentAdmissionFailure["failureClass"] {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("cancel") || message.includes("abort")) return "cancelled";
  if (message.includes("timeout") || message.includes("deadline")) return "timed-out";
  if (message.includes("invalid") || message.includes("validation") || message.includes("scope")) return "invalid";
  if (message.includes("host") || message.includes("extension")) return "host-failed";
  if (message.includes("unavailable") || message.includes("does not exist") || message.includes("not found")) return "unavailable";
  return "failed";
}
function admissionState(value: unknown): string | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).state === "string"
    ? (value as Record<string, unknown>).state as string
    : undefined;
}
