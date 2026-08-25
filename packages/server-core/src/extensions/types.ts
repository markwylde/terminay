import type {
  AgentLifecycleEvent,
  AgentProviderContribution,
  ExtensionDependency,
  JsonValue,
  ProjectEnvironmentContribution,
  ProviderDependencyCallContext,
  ProviderDependencyRequest,
  ProviderDefinition,
  ProviderRuntimeMethod,
} from "@terminay/extension-api";

/**
 * Server-issued identity for one terminal incarnation. Lifecycle publication
 * is scoped to this context. On This server the child also receives `shellPid`
 * so it can observe the PTY with Node.
 */
export interface ExtensionAgentTerminalContext {
  readonly contextId: string;
  readonly serverId: string;
  readonly projectId: string;
  readonly projectEnvironmentId: string;
  readonly terminalSessionId: string;
  readonly terminalIncarnationId: string;
  readonly providerId: string;
  /** Present for This-server PTYs so the extension child can observe with Node. */
  readonly shellPid?: number;
  readonly ttyPath?: string;
}

export interface ExtensionAgentTerminalAdmission {
  readonly context: ExtensionAgentTerminalContext;
  readonly observationCapabilities: readonly string[];
}

export type ExtensionAgentTerminalCancellationReason =
  | "terminal-closed"
  | "terminal-replaced"
  | "provider-disabled"
  | "extension-stopped"
  | "server-stopping";

export interface ExtensionAgentTerminalCancellation {
  readonly contextId: string;
  readonly reason: ExtensionAgentTerminalCancellationReason;
}

/**
 * A request made by an admitted agent runtime. The host routes it through the
 * terminal's project environment and validates both the operation and payload
 * before exposing any process or filesystem facts.
 */
export type ExtensionAgentObservationOperation =
  | "process.foreground"
  | "process.descendants"
  | "process.open-files"
  | "process.environment"
  | "terminal.tty"
  | "filesystem.resolve-home-relative"
  | "filesystem.resolve-home-directory"
  | "filesystem.resolve-path-under-home"
  | "filesystem.home-relative-path"
  | "filesystem.resolve-relative-to-environment"
  | "filesystem.resolve-directory-relative-to-environment"
  | "filesystem.resolve-path-under-environment"
  | "filesystem.environment-relative-path"
  | "filesystem.list-directory"
  | "filesystem.watch-directory"
  | "filesystem.unwatch-directory"
  | "filesystem.realpath"
  | "filesystem.stat"
  | "filesystem.read"
  | "filesystem.follow"
  | "filesystem.unfollow";

export interface ExtensionAgentObservationRequest {
  readonly contextId: string;
  readonly providerId: string;
  readonly operation: ExtensionAgentObservationOperation;
  readonly payload: JsonValue;
}

export interface ExtensionAgentObservationResult {
  readonly contextId: string;
  readonly ok: boolean;
  readonly value?: JsonValue;
  readonly failure?: string;
}

/**
 * Provider-normalized lifecycle events remain structured JSON at this private
 * IPC boundary. Canonical event validation, terminal ownership, and ordering
 * are host responsibilities and happen before acknowledgement.
 */
export interface ExtensionAgentLifecyclePublication {
  readonly contextId: string;
  readonly providerId: string;
  readonly publicationId: string;
  readonly mappingVersion: string;
  /** A bind publication contains no lifecycle events and establishes the
   * provider session identity before any later lifecycle publication. */
  readonly binding?: JsonValue;
  readonly events: readonly AgentLifecycleEvent[];
}

export interface ExtensionAgentLifecycleAcknowledgement {
  readonly contextId: string;
  readonly publicationId: string;
  readonly acceptedEventCount: number;
  readonly rejectedEventCount: number;
  readonly failure?: string;
}

/**
 * The host can pause publication without dropping a terminal binding. A child
 * must retain its bounded pending events and resume only when the state returns
 * to normal or a later acknowledgement permits progress.
 */
export interface ExtensionAgentLifecycleBackpressure {
  readonly contextId: string;
  readonly state: "normal" | "pause" | "drain";
  readonly maxInFlightPublications: number;
  readonly retryAfterMs?: number;
}

export interface ExtensionAgentDrainRequest {
  readonly reason: "provider-disabled" | "extension-stopped" | "server-stopping";
}

export type ExtensionHostState =
  | "stopped"
  | "starting"
  | "running"
  | "failed"
  | "quarantined";

export interface ExtensionLaunchDescriptor {
  readonly extensionId: string;
  readonly packageRoot: string;
  readonly entrypoint: string;
  readonly configDirectory: string;
  readonly dataDirectory: string;
  readonly cacheDirectory: string;
  readonly permissions: readonly string[];
  /** Parsed public manifest contribution metadata. The installer supplies it
   * after public manifest validation; the host uses it to reject undeclared
   * child registrations before they become live. */
  readonly agentProviders?: readonly AgentProviderContribution[];
  readonly projectEnvironmentProviders?: readonly ProjectEnvironmentContribution[];
  readonly extensionDependencies?: readonly ExtensionDependency[];
}

export interface ExtensionHostStatus {
  readonly extensionId: string;
  readonly state: ExtensionHostState;
  readonly consecutiveCrashes: number;
  readonly restartAt?: number;
  readonly failure?: string;
  readonly providers?: readonly ProviderDefinition[];
  readonly agentProviders?: readonly AgentProviderContribution[];
}

export interface ExtensionInvocation {
  readonly method: string;
  readonly input?: unknown;
  readonly deadlineMs?: number;
  readonly signal?: AbortSignal;
}

export type ExtensionProviderCallback = ProviderRuntimeMethod;

export interface ExtensionProviderInvocation {
  readonly providerId: string;
  readonly callback: ExtensionProviderCallback;
  readonly request: JsonValue;
  readonly deadlineMs?: number;
  readonly idempotencyKey?: string;
  readonly expectedRevision?: number;
  readonly signal?: AbortSignal;
}

export interface ExtensionBrokerRequest {
  readonly extensionId: string;
  readonly operation: "log" | "secret.resolve" | "profile.get" | "agent.list" | "agent.sign" | "provider.call";
  readonly payload: unknown;
}

export interface ExtensionDependencyCall {
  readonly callerExtensionId: string;
  readonly callerProviderId: string;
  readonly request: ProviderDependencyRequest;
  readonly context: Omit<ProviderDependencyCallContext, "signal">;
  readonly signal: AbortSignal;
}

export interface ExtensionDependencyRouter {
  call(request: ExtensionDependencyCall): Promise<JsonValue>;
}

export interface ExtensionProfileSnapshot {
  readonly profileId: string;
  readonly providerId: string;
  readonly revision: number;
  readonly values: JsonValue;
  readonly secretFields: readonly string[];
}

export interface ExtensionProfileBroker {
  get(extensionId: string, providerId: string, profileId: string, signal: AbortSignal): Promise<ExtensionProfileSnapshot>;
}

export interface ExtensionSshAgentBroker {
  listIdentities(principal: { extensionId: string; profileId: string; purpose: "ssh-user-authentication" }, signal: AbortSignal): Promise<unknown>;
  sign(principal: { extensionId: string; profileId: string; purpose: "ssh-user-authentication" }, request: { identityId: string; challenge: Uint8Array; algorithm: string }, signal: AbortSignal): Promise<unknown>;
}

export interface ExtensionSecretAccessBroker {
  withSecret<T>(principal: { extensionId: string; permissions: ReadonlySet<string> }, request: { profileId: string; fieldId: string }, callback: (secret: Uint8Array) => T | Promise<T>): Promise<T>;
}

export interface ExtensionBroker {
  request(request: ExtensionBrokerRequest, signal: AbortSignal): Promise<unknown>;
}

/** Private host bridge for public agent-runtime operations. It deliberately
 * accepts already validated public DTOs and keeps environment routing,
 * binding ownership, canonical sequencing, and store reduction in Server
 * Core. Installed extensions never receive this bridge directly. */
export interface ExtensionAgentBroker {
  observe(
    request: Readonly<{
      extensionId: string;
      providerId: string;
      terminal: ExtensionAgentTerminalContext;
      operation: ExtensionAgentObservationOperation;
      payload: JsonValue;
    }>,
    signal: AbortSignal,
  ): Promise<JsonValue>;
  publish(
    request: Readonly<{
      extensionId: string;
      providerId: string;
      terminal: ExtensionAgentTerminalContext;
      publicationId: string;
      mappingVersion: string;
      binding?: JsonValue;
      events: readonly AgentLifecycleEvent[];
    }>,
    signal: AbortSignal,
  ): Promise<Readonly<{ acceptedEventCount: number; rejectedEventCount?: number; failure?: string }>>;
  terminalCancelled?(
    request: Readonly<{ extensionId: string; providerId: string; terminal: ExtensionAgentTerminalContext; reason: ExtensionAgentTerminalCancellationReason }>,
  ): Promise<void> | void;
}

export interface ExtensionHostLimits {
  readonly maxMessageBytes?: number;
  readonly maxConcurrentInvocations?: number;
  readonly startupTimeoutMs?: number;
  readonly invocationTimeoutMs?: number;
  readonly shutdownTimeoutMs?: number;
  readonly crashWindowMs?: number;
  readonly maxCrashesInWindow?: number;
  readonly initialBackoffMs?: number;
  readonly maxBackoffMs?: number;
}
