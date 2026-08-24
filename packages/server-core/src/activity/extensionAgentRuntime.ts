import type { AgentProviderContribution } from "@terminay/extension-api";
import { THIS_SERVER_ENVIRONMENT_ID } from "../workspace.js";
import type { ProjectEnvironmentRouter } from "../projectEnvironment/router.js";
import type { ExtensionHostManager } from "../extensions/manager.js";
import type { ExtensionAgentTerminalCancellationReason } from "../extensions/types.js";
import type { ExtensionAgentTerminalContext } from "../extensions/types.js";
import type { ThisServerAgentTerminal } from "../extensions/localAgentObservation.js";
import type { ActivitySessionIdentity } from "./service.js";
import { AgentStatusService } from "./agentService.js";

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
  context?: ExtensionAgentTerminalContext;
  lastProcessName?: string;
  reobserveTimer?: ReturnType<typeof setTimeout>;
  topologyTimer?: ReturnType<typeof setTimeout>;
  topologySignature?: string;
  topologyPolling?: boolean;
}

const LOCAL_CAPABILITIES = Object.freeze(["process-observation", "filesystem-observation", "agent-journal"]);

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
    this.makeContextId = options.contextId ?? ((identity, incarnation) =>
      `extension-agent:${identity.serverId}:${identity.projectId}:${identity.sessionId}:${incarnation}`);
    this.reobserveDebounceMs = Math.max(0, options.reobserveDebounceMs ?? 100);
    this.topologyPollIntervalMs = Math.max(100, options.topologyPollIntervalMs ?? 1_500);
    this.schedule = options.schedule ?? ((callback, milliseconds) => setTimeout(callback, milliseconds));
    this.cancelSchedule = options.cancelSchedule ?? ((timer) => clearTimeout(timer));
  }

  register(identity: ActivitySessionIdentity): void {
    const current = this.terminals.get(identity.sessionId);
    if (current !== undefined && sameIdentity(current.identity, identity)) return;
    this.terminals.set(identity.sessionId, { identity: Object.freeze({ ...identity }), incarnation: (current?.incarnation ?? 0) + 1 });
  }

  terminalStarted(identity: ActivitySessionIdentity, shellPid: number): void {
    const terminal = this.requireTerminal(identity);
    terminal.shellPid = shellPid;
  }

  /** Claims a matching local terminal synchronously, then performs the child
   * IPC admission in the background. Returning true means legacy foreground
   * and journal mutations are now suppressed by AgentStatusService. */
  foregroundProcessChanged(identity: ActivitySessionIdentity, processName: string): boolean {
    const terminal = this.requireTerminal(identity);
    const contribution = this.match(processName, identity);
    if (terminal.context !== undefined) {
      if (contribution?.id === terminal.context.providerId) this.scheduleReobserve(terminal, contribution, processName);
      return true;
    }
    if (contribution === undefined) return false;
    return this.claimAndAdmit(terminal, contribution, processName);
  }

  /** A host process/open-file watcher can call this when a still-matching
   * terminal topology changes. Debouncing prevents a burst of native process
   * events from creating overlapping child observers. */
  topologyChanged(identity: ActivitySessionIdentity): void {
    const terminal = this.terminals.get(identity.sessionId);
    if (terminal?.context === undefined || !sameIdentity(terminal.identity, identity)) return;
    const contribution = this.options.hosts.agentProviderContributions().find((value) => value.id === terminal.context!.providerId);
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
    });
    terminal.context = context;
    terminal.lastProcessName = processName;
    void this.options.hosts.admitAgentTerminal({ context, observationCapabilities: this.localObservationCapabilities }).then(() => {
      if (terminal.context === context) this.scheduleTopologyPoll(terminal);
    }).catch(() => {
      // The claim was synchronous so the legacy path did not see this exact
      // foreground change. Release and replay it if host admission fails.
      if (terminal.context !== context) return;
      terminal.context = undefined;
      try {
        this.options.agents.releaseExtensionProvider(identity, contribution.id);
        this.options.agents.foregroundProcessChanged(identity, processName, false);
      } catch { /* terminal was closed or replaced while admission was pending */ }
    });
    return true;
  }

  private scheduleReobserve(terminal: TrackedTerminal, contribution: AgentProviderContribution, processName: string): void {
    if (terminal.reobserveTimer !== undefined) return;
    terminal.reobserveTimer = this.schedule(() => {
      terminal.reobserveTimer = undefined;
      void this.reobserve(terminal, contribution, processName);
    }, this.reobserveDebounceMs);
  }

  private async reobserve(terminal: TrackedTerminal, contribution: AgentProviderContribution, processName: string): Promise<void> {
    const previous = terminal.context;
    if (previous === undefined || previous.providerId !== contribution.id) return;
    await this.options.hosts.cancelAgentTerminal({ contextId: previous.contextId, reason: "terminal-replaced" }).catch(() => undefined);
    if (terminal.context !== previous) return;
    terminal.context = undefined;
    try { this.options.agents.releaseExtensionProvider(terminal.identity, contribution.id); }
    catch { return; }
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
    for (const terminal of this.terminals.values()) this.clearTimers(terminal);
    this.terminals.clear();
    await this.options.hosts.drainAgentObservers(reason);
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
    const created: TrackedTerminal = { identity: Object.freeze({ ...identity }), incarnation: 1 };
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
      if (terminal.topologySignature !== undefined && terminal.topologySignature !== signature) this.topologyChanged(terminal.identity);
      terminal.topologySignature = signature;
    } catch { /* unavailable local/remote topology remains non-authoritative */ }
    finally {
      terminal.topologyPolling = false;
      if (terminal.context === context) this.scheduleTopologyPoll(terminal);
    }
  }

  private clearTimers(terminal: TrackedTerminal): void {
    if (terminal.reobserveTimer !== undefined) this.cancelSchedule(terminal.reobserveTimer);
    if (terminal.topologyTimer !== undefined) this.cancelSchedule(terminal.topologyTimer);
    terminal.reobserveTimer = undefined; terminal.topologyTimer = undefined;
  }

  private match(processName: string, identity: ActivitySessionIdentity): AgentProviderContribution | undefined {
    // Local node APIs must never be used for a routed remote project. The
    // fallback remains active until a remote environment adapter is supplied.
    if (this.projectEnvironmentId(identity) !== THIS_SERVER_ENVIRONMENT_ID) return undefined;
    const executable = executableName(processName);
    if (executable.length === 0) return undefined;
    return this.options.hosts.agentProviderContributions().find((provider) =>
      (provider.platforms === undefined || provider.platforms.includes(this.platform))
      && requiredCapabilitiesAvailable(provider, this.localObservationCapabilities)
      && provider.processMatchers?.some((matcher) => matcher.arguments === undefined && matcher.executableName.toLowerCase() === executable) === true,
    );
  }

  private projectEnvironmentId(identity: ActivitySessionIdentity): string {
    try { return this.options.projectEnvironmentRouter?.bindProject(identity.projectId).projectEnvironmentId ?? THIS_SERVER_ENVIRONMENT_ID; }
    catch { return "terminay:environment-unavailable"; }
  }
}

function requiredCapabilitiesAvailable(provider: AgentProviderContribution, available: readonly string[]): boolean {
  return provider.requiredEnvironmentCapabilities.every((capability) => available.includes(capability));
}
function executableName(value: string): string { return value.trim().split(/[\\/]/u).pop()?.toLowerCase() ?? ""; }
function sameIdentity(left: ActivitySessionIdentity, right: ActivitySessionIdentity): boolean { return left.serverId === right.serverId && left.projectId === right.projectId && left.sessionId === right.sessionId; }
function platformName(): "darwin" | "linux" | "win32" { return process.platform === "darwin" || process.platform === "win32" ? process.platform : "linux"; }
