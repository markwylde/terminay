import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isChildFrame, frameByteLength, EXTENSION_HOST_PROTOCOL_VERSION, type ChildFrame, type HostFrame } from "./protocol.js";
import { validateExtensionLaunchDescriptor } from "./descriptor.js";
import type { ExtensionAgentBroker, ExtensionAgentLifecyclePublication, ExtensionAgentObservationRequest, ExtensionAgentTerminalAdmission, ExtensionAgentTerminalCancellation, ExtensionAgentTerminalContext, ExtensionBroker, ExtensionHostLimits, ExtensionHostStatus, ExtensionInvocation, ExtensionLaunchDescriptor, ExtensionProfileBroker, ExtensionProviderInvocation, ExtensionSecretAccessBroker, ExtensionSshAgentBroker } from "./types.js";
import { isNamespacedId, validateAgentLifecycleEvent, validateDeclarativeForm, validateEnvironmentActionResult, validateOptionSourceResult, validateProviderDefinition, validateProviderEnvironmentStatus, validateProvisioningResult, validateSshAgentIdentities, validateSshAgentSignature, validateValidationIssues, type AgentProviderContribution, type ProviderDefinition } from "@terminay/extension-api";

interface PendingCall {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly abort?: () => void;
}

export interface ExtensionHostOptions {
  readonly broker: ExtensionBroker;
  readonly limits?: ExtensionHostLimits;
  readonly nodeExecutable?: string;
  readonly childEntrypoint?: string;
  readonly now?: () => number;
  readonly profiles?: ExtensionProfileBroker;
  readonly secrets?: ExtensionSecretAccessBroker;
  readonly sshAgent?: ExtensionSshAgentBroker;
  readonly agents?: ExtensionAgentBroker;
}

const DEFAULTS = Object.freeze({
  maxMessageBytes: 256 * 1024,
  maxConcurrentInvocations: 16,
  startupTimeoutMs: 15_000,
  invocationTimeoutMs: 30_000,
  shutdownTimeoutMs: 5_000,
  crashWindowMs: 60_000,
  maxCrashesInWindow: 5,
  initialBackoffMs: 250,
  maxBackoffMs: 30_000,
});

/** Supervises exactly one extension process. The process boundary is crash
 * isolation, not an OS security sandbox: installed extensions remain trusted
 * code running as the Terminay Server account. */
export class ExtensionHost {
  private child: ChildProcess | undefined;
  private descriptor: ExtensionLaunchDescriptor | undefined;
  private state: ExtensionHostStatus;
  private readonly pending = new Map<string, PendingCall>();
  private readonly activeBrokerCalls = new Map<string, AbortController>();
  private readonly crashTimes: number[] = [];
  private sequence = 0;
  private providerSequence = 0;
  private stopping = false;
  private providers: readonly ProviderDefinition[] = Object.freeze([]);
  private agentProviders: readonly AgentProviderContribution[] = Object.freeze([]);
  private readonly agentContexts = new Map<string, ExtensionAgentTerminalContext>();
  private agentPublicationsInFlight = 0;
  private readonly limits: Required<ExtensionHostLimits>;
  private readonly now: () => number;

  constructor(readonly extensionId: string, private readonly options: ExtensionHostOptions) {
    this.limits = { ...DEFAULTS, ...options.limits };
    this.now = options.now ?? Date.now;
    this.state = { extensionId, state: "stopped", consecutiveCrashes: 0 };
  }

  status(): ExtensionHostStatus { return Object.freeze({ ...this.state, providers: this.providers, agentProviders: this.agentProviders }); }

  async start(descriptor: ExtensionLaunchDescriptor): Promise<void> {
    if (descriptor.extensionId !== this.extensionId) throw new TypeError("extension descriptor identity mismatch");
    if (this.state.state === "quarantined") throw new Error("extension is quarantined");
    if (this.child !== undefined) return;
    const restartAt = this.state.restartAt;
    if (restartAt !== undefined && restartAt > this.now()) throw new Error("extension restart backoff is active");
    this.descriptor = await validateExtensionLaunchDescriptor(descriptor);
    this.stopping = false;
    this.state = { extensionId: this.extensionId, state: "starting", consecutiveCrashes: this.state.consecutiveCrashes };
    const childEntrypoint = this.options.childEntrypoint ?? fileURLToPath(new URL("./child.js", import.meta.url));
    const child = fork(childEntrypoint, [], {
      cwd: this.descriptor.packageRoot,
      execPath: this.options.nodeExecutable,
      execArgv: [],
      env: { ELECTRON_RUN_AS_NODE: "1", NODE_ENV: "production", TERMINAY_EXTENSION_HOST: "1" } as unknown as NodeJS.ProcessEnv,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      serialization: "json",
    });
    this.child = child;
    child.on("message", (message) => this.receive(message));
    child.once("error", (error) => { if (this.child === child) this.childFailed(error); });
    child.once("exit", (code, signal) => { if (this.child === child) this.childExited(code, signal); });
    try {
      const activated = await this.call("activate", {
        extensionId: this.extensionId,
        apiVersion: "1.0.0",
        entrypoint: this.descriptor.entrypoint,
        configDirectory: this.descriptor.configDirectory,
        dataDirectory: this.descriptor.dataDirectory,
        cacheDirectory: this.descriptor.cacheDirectory,
        permissions: [...this.descriptor.permissions],
        agentProviders: this.descriptor.agentProviders === undefined ? [] : structuredClone(this.descriptor.agentProviders),
      }, this.limits.startupTimeoutMs, undefined, true);
      this.providers = validateProviders(record(activated)?.providers, this.extensionId);
      this.agentProviders = validateAgentProviders(record(activated)?.agentProviders, this.descriptor);
      this.state = { extensionId: this.extensionId, state: "running", consecutiveCrashes: 0 };
    } catch (error) {
      this.terminateChild();
      this.recordFailure(error instanceof Error ? error : new Error("extension activation failed"));
      throw error;
    }
  }

  async invoke(invocation: ExtensionInvocation): Promise<unknown> {
    if (this.state.state !== "running" || this.child === undefined) throw new Error("extension is not running");
    if (this.pending.size >= this.limits.maxConcurrentInvocations) throw new Error("extension invocation admission limit reached");
    if (typeof invocation.method !== "string" || invocation.method.length === 0 || invocation.method.length > 200) throw new TypeError("invalid extension method");
    return this.call("invoke", { method: invocation.method, input: invocation.input }, invocation.deadlineMs ?? this.limits.invocationTimeoutMs, invocation.signal);
  }

  async invokeProvider(invocation: ExtensionProviderInvocation): Promise<unknown> {
    if (!this.providers.some((provider) => provider.providerId === invocation.providerId)) throw new Error("extension provider is not registered");
    const timeoutMs = invocation.deadlineMs ?? this.limits.invocationTimeoutMs;
    const callId = `${this.extensionId}:provider:${++this.providerSequence}`;
    const reply = record(await this.invoke({
      method: "provider.invoke",
      input: {
        callId,
        providerId: invocation.providerId,
        method: invocation.callback,
        request: invocation.request,
        deadlineAt: new Date(this.now() + timeoutMs).toISOString(),
        ...(invocation.idempotencyKey === undefined ? {} : { idempotencyKey: invocation.idempotencyKey }),
        ...(invocation.expectedRevision === undefined ? {} : { expectedRevision: invocation.expectedRevision }),
      },
      deadlineMs: timeoutMs,
      signal: invocation.signal,
    }));
    if (reply === undefined || reply.callId !== callId || reply.ok !== true || !("result" in reply)) throw new Error("provider returned an invalid runtime reply");
    return validateProviderResult(invocation.callback, reply.result, invocation.request);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    if (child === undefined) {
      this.state = { extensionId: this.extensionId, state: "stopped", consecutiveCrashes: this.state.consecutiveCrashes };
      return;
    }
    await this.drainAgentObservers("extension-stopped").catch(() => undefined);
    try { await this.call("deactivate", undefined, this.limits.shutdownTimeoutMs); } catch { /* bounded forced termination below */ }
    this.terminateChild();
    this.rejectPending(new Error("extension host stopped"));
    this.state = { extensionId: this.extensionId, state: "stopped", consecutiveCrashes: this.state.consecutiveCrashes };
    this.providers = Object.freeze([]);
    this.agentProviders = Object.freeze([]);
  }

  clearQuarantine(): void {
    if (this.child !== undefined) throw new Error("cannot clear quarantine while extension is running");
    this.crashTimes.length = 0;
    this.state = { extensionId: this.extensionId, state: "stopped", consecutiveCrashes: 0 };
  }

  /** Admit exactly one server-issued terminal incarnation to one registered
   * agent provider. The child cannot manufacture this context. */
  async admitAgentTerminal(admission: ExtensionAgentTerminalAdmission, signal?: AbortSignal): Promise<unknown> {
    const context = validateAgentTerminalAdmission(admission, this.extensionId, this.agentProviders);
    if (this.agentContexts.has(context.contextId)) throw new Error("agent terminal context is already admitted");
    this.agentContexts.set(context.contextId, context);
    try {
      return await this.call("agent.terminal.admit", admission, this.limits.invocationTimeoutMs, signal);
    } catch (error) {
      await this.retireAgentContext(context.contextId, "terminal-replaced");
      throw error;
    }
  }

  async cancelAgentTerminal(cancellation: ExtensionAgentTerminalCancellation): Promise<boolean> {
    const context = this.agentContexts.get(cancellation.contextId);
    if (context === undefined) return false;
    await this.call("agent.terminal.cancel", cancellation, this.limits.shutdownTimeoutMs).catch(() => undefined);
    await this.retireAgentContext(cancellation.contextId, cancellation.reason);
    return true;
  }

  async drainAgentObservers(reason: "provider-disabled" | "extension-stopped" | "server-stopping"): Promise<void> {
    if (this.agentContexts.size === 0) return;
    await this.call("agent.drain", { reason }, this.limits.shutdownTimeoutMs).catch(() => undefined);
    for (const contextId of [...this.agentContexts.keys()]) await this.retireAgentContext(contextId, reason);
  }

  private call(kind: HostFrame["kind"], payload: unknown, timeoutMs: number, signal?: AbortSignal, allowStarting = false): Promise<unknown> {
    if (this.child === undefined || (!allowStarting && this.state.state !== "running" && kind !== "deactivate")) return Promise.reject(new Error("extension child is unavailable"));
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300_000) return Promise.reject(new TypeError("invalid extension deadline"));
    const id = `${this.extensionId}:${++this.sequence}`;
    const frame: HostFrame = { protocolVersion: EXTENSION_HOST_PROTOCOL_VERSION, kind, id, ...(payload === undefined ? {} : { payload }) };
    if (frameByteLength(frame) > this.limits.maxMessageBytes) return Promise.reject(new Error("extension IPC message exceeds limit"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.send({ protocolVersion: EXTENSION_HOST_PROTOCOL_VERSION, kind: "cancel", id });
        reject(new Error(`extension ${kind} timed out`));
      }, timeoutMs);
      const abort = signal === undefined ? undefined : () => {
        clearTimeout(timer); this.pending.delete(id);
        this.send({ protocolVersion: EXTENSION_HOST_PROTOCOL_VERSION, kind: "cancel", id });
        reject(new Error("extension invocation cancelled"));
      };
      if (signal?.aborted) { clearTimeout(timer); reject(new Error("extension invocation cancelled")); return; }
      signal?.addEventListener("abort", abort!, { once: true });
      this.pending.set(id, { resolve, reject, timer, ...(abort === undefined ? {} : { abort }) });
      if (!this.send(frame)) {
        this.finishPending(id, undefined, new Error("extension IPC send failed"));
      }
    });
  }

  private send(frame: HostFrame): boolean {
    if (this.child === undefined || !this.child.connected || frameByteLength(frame) > this.limits.maxMessageBytes) return false;
    try { return this.child.send(frame); } catch { return false; }
  }

  private receive(message: unknown): void {
    if (frameByteLength(message) > this.limits.maxMessageBytes) { this.protocolViolation("oversized child message"); return; }
    if (!isChildFrame(message)) { this.protocolViolation("malformed child message"); return; }
    if (message.kind === "broker.request") { void this.handleBrokerRequest(message); return; }
    if (message.kind === "agent.observation.request") { void this.handleAgentObservationRequest(message); return; }
    if (message.kind === "agent.lifecycle.publish") { void this.handleAgentLifecyclePublication(message); return; }
    if (message.kind === "agent.provider.disposed") { void this.handleAgentProviderDisposed(message); return; }
    if (message.kind === "ready" || message.kind === "result" || message.kind === "deactivated" || message.kind === "agent.terminal.admitted" || message.kind === "agent.terminal.cancelled" || message.kind === "agent.drain.completed") this.finishPending(message.id, message.payload);
    else this.finishPending(message.id, undefined, new Error(failureMessage(message.payload)));
  }

  private async handleBrokerRequest(frame: ChildFrame): Promise<void> {
    if (this.activeBrokerCalls.size >= this.limits.maxConcurrentInvocations) { this.sendBrokerResult(frame.id, undefined, "broker admission limit reached"); return; }
    const payload = record(frame.payload);
    const operation = payload?.operation;
    if (operation !== "log" && operation !== "secret.resolve" && operation !== "profile.get" && operation !== "agent.list" && operation !== "agent.sign" && operation !== "provider.call") { this.sendBrokerResult(frame.id, undefined, "unsupported broker operation"); return; }
    const controller = new AbortController(); this.activeBrokerCalls.set(frame.id, controller);
    try {
      const result = operation === "profile.get"
        ? await this.readProfile(payload?.payload, controller.signal)
        : operation === "secret.resolve"
          ? await this.resolveSecret(payload?.payload, controller.signal)
          : operation === "agent.list" || operation === "agent.sign"
            ? await this.useSshAgent(operation, payload?.payload, controller.signal)
          : await this.options.broker.request({ extensionId: this.extensionId, operation, payload: payload?.payload }, controller.signal);
      this.sendBrokerResult(frame.id, result);
    } catch (error) { this.sendBrokerResult(frame.id, undefined, error instanceof Error ? error.message : "broker request failed"); }
    finally { this.activeBrokerCalls.delete(frame.id); }
  }

  private async handleAgentObservationRequest(frame: ChildFrame): Promise<void> {
    const request = parseAgentObservationRequest(frame.payload);
    if (request === undefined) { this.sendAgentObservationResult(frame.id, { contextId: "", ok: false, failure: "invalid agent observation request" }); return; }
    const context = this.agentContexts.get(request.contextId);
    if (context === undefined || context.providerId !== request.providerId || this.options.agents === undefined) {
      this.sendAgentObservationResult(frame.id, { contextId: request.contextId, ok: false, failure: "agent observation scope is unavailable" }); return;
    }
    if (!this.agentObservationIsDeclared(request)) {
      this.sendAgentObservationResult(frame.id, { contextId: request.contextId, ok: false, failure: "agent environment observation is not declared" }); return;
    }
    const controller = new AbortController(); this.activeBrokerCalls.set(frame.id, controller);
    try {
      const value = await this.options.agents.observe({ extensionId: this.extensionId, providerId: request.providerId, terminal: context, operation: request.operation, payload: request.payload }, controller.signal);
      this.sendAgentObservationResult(frame.id, { contextId: request.contextId, ok: true, value });
    } catch (error) {
      this.sendAgentObservationResult(frame.id, { contextId: request.contextId, ok: false, failure: safeFailure(error instanceof Error ? error : new Error("agent observation failed")) });
    } finally { this.activeBrokerCalls.delete(frame.id); }
  }

  private agentObservationIsDeclared(request: ExtensionAgentObservationRequest): boolean {
    if (request.operation !== "process.environment" && !request.operation.includes("environment")) return true;
    const provider = this.agentProviders.find((value) => value.id === request.providerId);
    const payload = record(request.payload);
    const names = request.operation === "process.environment" ? payload?.names : [payload?.environmentVariable];
    return Array.isArray(names) && names.length > 0 && names.length <= 16
      && names.every((name) => typeof name === "string" && provider?.requiredEnvironmentVariables?.includes(name));
  }

  private async handleAgentLifecyclePublication(frame: ChildFrame): Promise<void> {
    const publication = parseAgentLifecyclePublication(frame.payload);
    if (publication === undefined) { this.sendAgentLifecycleAck(frame.id, { contextId: "", publicationId: "", acceptedEventCount: 0, rejectedEventCount: 0, failure: "invalid agent lifecycle publication" }); return; }
    const context = this.agentContexts.get(publication.contextId);
    if (context === undefined || context.providerId !== publication.providerId || this.options.agents === undefined) {
      this.sendAgentLifecycleAck(frame.id, { contextId: publication.contextId, publicationId: publication.publicationId, acceptedEventCount: 0, rejectedEventCount: publication.events.length, failure: "agent lifecycle scope is unavailable" }); return;
    }
    if (this.agentPublicationsInFlight >= this.limits.maxConcurrentInvocations) {
      this.send({ protocolVersion: EXTENSION_HOST_PROTOCOL_VERSION, kind: "agent.lifecycle.backpressure", id: frame.id, payload: { contextId: publication.contextId, state: "pause", maxInFlightPublications: this.limits.maxConcurrentInvocations, retryAfterMs: 50 } });
      this.sendAgentLifecycleAck(frame.id, { contextId: publication.contextId, publicationId: publication.publicationId, acceptedEventCount: 0, rejectedEventCount: publication.events.length, failure: "agent lifecycle publication is backpressured" });
      return;
    }
    this.agentPublicationsInFlight += 1;
    const controller = new AbortController(); this.activeBrokerCalls.set(frame.id, controller);
    try {
      const result = await this.options.agents.publish({ extensionId: this.extensionId, providerId: publication.providerId, terminal: context, publicationId: publication.publicationId, mappingVersion: publication.mappingVersion, ...(publication.binding === undefined ? {} : { binding: publication.binding }), events: publication.events }, controller.signal);
      this.sendAgentLifecycleAck(frame.id, { contextId: publication.contextId, publicationId: publication.publicationId, acceptedEventCount: result.acceptedEventCount, rejectedEventCount: result.rejectedEventCount ?? 0, ...(result.failure === undefined ? {} : { failure: safeFailure(new Error(result.failure)) }) });
    } catch (error) {
      this.sendAgentLifecycleAck(frame.id, { contextId: publication.contextId, publicationId: publication.publicationId, acceptedEventCount: 0, rejectedEventCount: publication.events.length, failure: safeFailure(error instanceof Error ? error : new Error("agent lifecycle publication failed")) });
    } finally {
      this.activeBrokerCalls.delete(frame.id);
      this.agentPublicationsInFlight -= 1;
      this.send({ protocolVersion: EXTENSION_HOST_PROTOCOL_VERSION, kind: "agent.lifecycle.backpressure", id: frame.id, payload: { contextId: publication.contextId, state: "normal", maxInFlightPublications: this.limits.maxConcurrentInvocations } });
    }
  }

  private async handleAgentProviderDisposed(frame: ChildFrame): Promise<void> {
    const providerId = boundedId(record(frame.payload)?.providerId);
    if (providerId === undefined || !this.agentProviders.some((provider) => provider.id === providerId)) { this.protocolViolation("agent provider disposal is invalid"); return; }
    this.agentProviders = Object.freeze(this.agentProviders.filter((provider) => provider.id !== providerId));
    for (const [contextId, context] of this.agentContexts) if (context.providerId === providerId) await this.retireAgentContext(contextId, "provider-disabled");
  }

  private sendAgentObservationResult(id: string, result: { readonly contextId: string; readonly ok: boolean; readonly value?: unknown; readonly failure?: string }): void {
    if (!this.send({ protocolVersion: EXTENSION_HOST_PROTOCOL_VERSION, kind: "agent.observation.result", id, payload: result })) this.protocolViolation("agent observation result exceeds IPC limit");
  }

  private sendAgentLifecycleAck(id: string, acknowledgement: { readonly contextId: string; readonly publicationId: string; readonly acceptedEventCount: number; readonly rejectedEventCount: number; readonly failure?: string }): void {
    if (!this.send({ protocolVersion: EXTENSION_HOST_PROTOCOL_VERSION, kind: "agent.lifecycle.ack", id, payload: acknowledgement })) this.protocolViolation("agent lifecycle acknowledgement exceeds IPC limit");
  }

  private async retireAgentContext(contextId: string, reason: ExtensionAgentTerminalCancellation["reason"]): Promise<void> {
    const context = this.agentContexts.get(contextId);
    if (context === undefined) return;
    this.agentContexts.delete(contextId);
    await this.options.agents?.terminalCancelled?.({ extensionId: this.extensionId, providerId: context.providerId, terminal: context, reason });
  }

  private async readProfile(input: unknown, signal: AbortSignal): Promise<unknown> {
    if (this.options.profiles === undefined) throw new Error("extension profile broker is unavailable");
    const request = record(input);
    const providerId = boundedId(request?.providerId); const profileId = boundedId(request?.profileId);
    if (providerId === undefined || profileId === undefined || !this.providers.some((provider) => provider.providerId === providerId)) throw new Error("extension profile access is denied");
    return this.options.profiles.get(this.extensionId, providerId, profileId, signal);
  }

  private async useSshAgent(operation: "agent.list" | "agent.sign", input: unknown, signal: AbortSignal): Promise<unknown> {
    if (this.options.sshAgent === undefined || this.descriptor === undefined || !this.descriptor.permissions.includes("ssh-agent:use")) throw new Error("SSH agent access is denied");
    const request = record(input); const profileId = boundedId(request?.profileId);
    if (profileId === undefined) throw new Error("SSH agent access is denied");
    if (request?.purpose !== "ssh-user-authentication") throw new Error("SSH agent access is denied");
    const principal = { extensionId: this.extensionId, profileId, purpose: "ssh-user-authentication" as const };
    if (operation === "agent.list") return validated(validateSshAgentIdentities(await this.options.sshAgent.listIdentities(principal, signal)), "SSH agent returned invalid identities");
    const identityId = boundedId(request?.identityId); const bytes = request?.challenge;
    if (identityId === undefined || typeof request?.algorithm !== "string" || !Array.isArray(bytes) || bytes.length > 64 * 1024 || bytes.some((byte) => !Number.isInteger(byte) || Number(byte) < 0 || Number(byte) > 255)) throw new Error("SSH agent signing request is invalid");
    return validated(validateSshAgentSignature(await this.options.sshAgent.sign(principal, { identityId, challenge: new Uint8Array(bytes as number[]), algorithm: request.algorithm }, signal)), "SSH agent returned invalid signature");
  }

  private async resolveSecret(input: unknown, signal: AbortSignal): Promise<unknown> {
    if (this.options.secrets === undefined || this.descriptor === undefined) throw new Error("extension secret broker is unavailable");
    if (signal.aborted) throw new Error("extension secret access cancelled");
    const request = record(input); const profileId = boundedId(request?.profileId); const fieldId = boundedId(request?.fieldId);
    if (profileId === undefined || fieldId === undefined) throw new Error("extension secret access is denied");
    return this.options.secrets.withSecret(
      { extensionId: this.extensionId, permissions: new Set(this.descriptor.permissions.map((permission) => permission === "secrets:resolve" ? "extension-secrets:resolve" : permission)) },
      { profileId, fieldId },
      (secret) => {
        if (signal.aborted) throw new Error("extension secret access cancelled");
        // The numeric array is the one bounded structured-clone copy crossing
        // private IPC. The vault/broker-owned Uint8Array is cleared by its
        // callback lifetime before this method returns.
        return [...secret];
      },
    );
  }

  private sendBrokerResult(id: string, value?: unknown, failure?: string): void {
    const payload = failure === undefined ? { ok: true, value } : { ok: false, failure };
    if (!this.send({ protocolVersion: EXTENSION_HOST_PROTOCOL_VERSION, kind: "broker.result", id, payload })) this.protocolViolation("broker response exceeds IPC limit");
  }

  private finishPending(id: string, result?: unknown, error?: Error): void {
    const pending = this.pending.get(id); if (pending === undefined) return;
    this.pending.delete(id); clearTimeout(pending.timer);
    if (pending.abort !== undefined) { /* listener is once and harmless after settlement */ }
    error === undefined ? pending.resolve(result) : pending.reject(error);
  }

  private protocolViolation(message: string): void { this.terminateChild(); this.recordFailure(new Error(message)); }
  private childFailed(error: Error): void { if (!this.stopping) this.recordFailure(error); }
  private childExited(code: number | null, signal: string | null): void {
    this.child = undefined;
    this.rejectPending(new Error("extension child exited"));
    for (const controller of this.activeBrokerCalls.values()) controller.abort();
    this.activeBrokerCalls.clear();
    void this.drainAgentObservers("extension-stopped");
    if (!this.stopping && this.state.state !== "failed" && this.state.state !== "quarantined") this.recordFailure(new Error(`extension child exited (${code ?? signal ?? "unknown"})`));
  }

  private recordFailure(error: Error): void {
    const now = this.now(); this.crashTimes.push(now);
    while ((this.crashTimes[0] ?? now) < now - this.limits.crashWindowMs) this.crashTimes.shift();
    const crashes = this.crashTimes.length;
    this.rejectPending(error);
    this.providers = Object.freeze([]);
    this.agentProviders = Object.freeze([]);
    if (crashes >= this.limits.maxCrashesInWindow) {
      this.state = { extensionId: this.extensionId, state: "quarantined", consecutiveCrashes: crashes, failure: safeFailure(error) };
      return;
    }
    const backoff = Math.min(this.limits.initialBackoffMs * (2 ** Math.max(0, crashes - 1)), this.limits.maxBackoffMs);
    this.state = { extensionId: this.extensionId, state: "failed", consecutiveCrashes: crashes, restartAt: now + backoff, failure: safeFailure(error) };
  }

  private terminateChild(): void { const child = this.child; this.child = undefined; if (child !== undefined) { child.removeAllListeners(); child.kill("SIGKILL"); } }
  private rejectPending(error: Error): void { for (const id of [...this.pending.keys()]) this.finishPending(id, undefined, error); }
}

function record(value: unknown): Record<string, unknown> | undefined { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function failureMessage(value: unknown): string { const message = record(value)?.message; return typeof message === "string" ? message.slice(0, 1_000) : "extension operation failed"; }
function safeFailure(error: Error): string { return error.message.replace(/[\r\n]/gu, " ").slice(0, 1_000); }
function boundedId(value: unknown): string | undefined { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(value) ? value : undefined; }
function validateProviders(value: unknown, extensionId: string): readonly ProviderDefinition[] {
  if (!Array.isArray(value) || value.length > 32) throw new Error("extension returned invalid provider registrations");
  const seen = new Set<string>();
  const providers: ProviderDefinition[] = [];
  for (const item of value) {
    const provider = record(item);
    const validation = validateProviderDefinition(item);
    if (provider === undefined || !validation.ok || typeof provider.providerId !== "string" || !isNamespacedId(provider.providerId, extensionId) || seen.has(provider.providerId)) throw new Error("extension returned invalid provider registrations");
    for (const form of [provider.profileForm, provider.createForm]) {
      if (form !== undefined && !validateDeclarativeForm(form).ok) throw new Error("extension returned an invalid declarative form");
    }
    seen.add(provider.providerId);
    providers.push(structuredClone(item) as ProviderDefinition);
  }
  return Object.freeze(providers);
}

function validateAgentProviders(value: unknown, descriptor: ExtensionLaunchDescriptor): readonly AgentProviderContribution[] {
  if (!Array.isArray(value) || value.length > 32 || (value.length > 0 && !descriptor.permissions.includes("agent-observation"))) {
    throw new Error("extension returned invalid agent provider registrations");
  }
  const declared = new Map((descriptor.agentProviders ?? []).map((provider) => [provider.id, provider]));
  const seen = new Set<string>(); const result: AgentProviderContribution[] = [];
  for (const valueId of value) {
    if (typeof valueId !== "string" || seen.has(valueId) || !isNamespacedId(valueId, descriptor.extensionId)) throw new Error("extension returned invalid agent provider registrations");
    const contribution = declared.get(valueId);
    if (contribution === undefined) throw new Error("extension registered an undeclared agent provider");
    seen.add(valueId); result.push(structuredClone(contribution));
  }
  return Object.freeze(result);
}

function validateAgentTerminalAdmission(value: ExtensionAgentTerminalAdmission, extensionId: string, providers: readonly AgentProviderContribution[]): ExtensionAgentTerminalContext {
  const context = value?.context;
  if (!context || !boundedId(context.contextId) || !boundedId(context.serverId) || !boundedId(context.projectId) || !boundedId(context.projectEnvironmentId) || !boundedId(context.terminalSessionId) || !boundedId(context.terminalIncarnationId) || !boundedId(context.providerId) || !providers.some((provider) => provider.id === context.providerId)) {
    throw new Error("agent terminal admission is outside the registered provider scope");
  }
  if (!Array.isArray(value.observationCapabilities) || value.observationCapabilities.length > 16 || value.observationCapabilities.some((capability) => typeof capability !== "string" || capability.length === 0 || capability.length > 100)) {
    throw new Error("agent terminal admission has invalid observation capabilities");
  }
  const provider = providers.find((candidate) => candidate.id === context.providerId)!;
  if (value.observationCapabilities.some((capability) => !provider.requiredEnvironmentCapabilities.includes(capability as never))) throw new Error("agent terminal admission exceeds provider capabilities");
  // The manager is the only API that calls this method; this check documents
  // and enforces the same extension/provider namespace ownership at runtime.
  if (!isNamespacedId(context.providerId, extensionId)) throw new Error("agent terminal admission provider is invalid");
  return Object.freeze(structuredClone(context));
}

function parseAgentObservationRequest(value: unknown): ExtensionAgentObservationRequest | undefined {
  const payload = record(value); const contextId = boundedId(payload?.contextId); const providerId = boundedId(payload?.providerId); const operation = payload?.operation;
  if (!contextId || !providerId || typeof operation !== "string" || !["process.foreground", "process.descendants", "process.open-files", "process.environment", "terminal.tty", "filesystem.resolve-home-relative", "filesystem.resolve-path-under-home", "filesystem.home-relative-path", "filesystem.resolve-relative-to-environment", "filesystem.resolve-path-under-environment", "filesystem.environment-relative-path", "filesystem.realpath", "filesystem.stat", "filesystem.read", "filesystem.follow", "filesystem.unfollow"].includes(operation) || !jsonValue(payload?.payload)) return undefined;
  return Object.freeze({ contextId, providerId, operation: operation as import("./types.js").ExtensionAgentObservationOperation, payload: structuredClone(payload!.payload) as import("@terminay/extension-api").JsonValue });
}

function parseAgentLifecyclePublication(value: unknown): ExtensionAgentLifecyclePublication | undefined {
  const payload = record(value); const contextId = boundedId(payload?.contextId); const providerId = boundedId(payload?.providerId); const publicationId = boundedId(payload?.publicationId);
  if (!contextId || !providerId || !publicationId || typeof payload?.mappingVersion !== "string" || payload.mappingVersion.length === 0 || payload.mappingVersion.length > 64 || !Array.isArray(payload.events) || payload.events.length > 64 || (payload.binding !== undefined && !jsonValue(payload.binding))) return undefined;
  const events = [] as import("@terminay/extension-api").AgentLifecycleEvent[];
  for (const event of payload.events) {
    const validation = validateAgentLifecycleEvent(event);
    if (!validation.ok) return undefined;
    events.push(structuredClone(validation.value));
  }
  return Object.freeze({ contextId, providerId, publicationId, mappingVersion: payload.mappingVersion, ...(payload.binding === undefined ? {} : { binding: structuredClone(payload.binding) as import("@terminay/extension-api").JsonValue }), events: Object.freeze(events) });
}

function jsonValue(value: unknown, depth = 0): value is import("@terminay/extension-api").JsonValue {
  if (depth > 8 || value === null || typeof value === "string" || typeof value === "boolean") return depth <= 8 && (typeof value !== "string" || value.length <= 64 * 1024);
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 256 && value.every((item) => jsonValue(item, depth + 1));
  const objectValue = record(value);
  if (objectValue === undefined || Object.keys(objectValue).length > 128) return false;
  return Object.entries(objectValue).every(([key, item]) => key.length <= 256 && jsonValue(item, depth + 1));
}
function validateProviderResult(callback: ExtensionProviderInvocation["callback"], result: unknown, request?: unknown): unknown {
  if (callback === "invokeService") return validateServiceResult(result, request);
  if (callback === "resolveOptions") return validated(validateOptionSourceResult(result), "provider returned invalid options");
  if (callback === "getStatus") return validated(validateProviderEnvironmentStatus(result), "provider returned invalid status");
  if (callback === "testProfile") return validated(validateValidationIssues(result), "provider returned invalid validation issues");
  if (callback === "createEnvironment" || callback === "resumeOperation") return validated(validateProvisioningResult(result), "provider returned an invalid provisioning result");
  return validated(validateEnvironmentActionResult(result), "provider returned an invalid action result");
}
function validateServiceResult(result: unknown, request: unknown): unknown {
  const call = record(request); const value = record(result);
  const capability = call?.capability; const operation = call?.operation;
  if (value === undefined || hasExecutable(value)) throw new Error("provider returned an invalid service result");
  if (capability === "terminal") {
    if (operation === "create" && (!exactKeys(value, ["sessionId","profileId","revision","root","shellProfile","capabilities"]) || !boundedText(value.sessionId,256) || !boundedText(value.profileId,256) || !positive(value.revision) || !boundedText(value.root,4096) || value.shellProfile !== "remote-system-default" || record(value.capabilities) === undefined)) throw new Error("provider returned an invalid terminal create result");
    else if (operation === "read" && (!exactKeys(value, ["data","encoding","exit"]) || value.encoding !== "base64" || typeof value.data !== "string" || value.data.length > 220_000 || !base64(value.data) || (value.exit !== undefined && !terminalExit(value.exit)))) throw new Error("provider returned an invalid terminal read result");
    else if (["input", "resize", "kill", "dispose"].includes(String(operation)) && (!exactKeys(value,["accepted"]) || value.accepted !== true)) throw new Error("provider returned an invalid terminal acknowledgement");
    else if (!["create", "read", "input", "resize", "kill", "dispose"].includes(String(operation))) throw new Error("provider returned an unknown terminal operation");
  } else if (capability === "filesystem") {
    if (!["resolveRoot", "browse", "realpath", "stat", "list", "read", "write", "createDirectory", "rename", "remove"].includes(String(operation))) throw new Error("provider returned an unknown filesystem operation");
    if (operation === "resolveRoot" && (!exactKeys(value,["root"]) || !boundedText(value.root,4096))) throw new Error("provider returned an invalid root result");
    else if (operation === "realpath" && (!exactKeys(value,["path"]) || !boundedText(value.path,4096))) throw new Error("provider returned an invalid realpath result");
    else if (operation === "read" && (!exactKeys(value,["path","data","encoding","metadata"]) || !boundedText(value.path,4096) || value.encoding !== "base64" || typeof value.data !== "string" || value.data.length > 220_000 || !base64(value.data) || !metadata(value.metadata))) throw new Error("provider returned an invalid filesystem read result");
    else if ((operation === "stat") && (!exactKeys(value,["path","size","mode","mtimeMs","atimeMs","type"]) || !metadata(value))) throw new Error("provider returned invalid metadata");
    else if ((operation === "browse" || operation === "list") && (!exactKeys(value,["path","entries"]) || !boundedText(value.path,4096) || !Array.isArray(value.entries) || value.entries.length > 10_000 || value.entries.some((entry) => { const item=record(entry); return item===undefined || !exactKeys(item,["name","path","size","mode","mtimeMs","atimeMs","type"]) || !boundedText(item.name,1024) || !metadata(item); }))) throw new Error("provider returned an invalid directory result");
    else if (operation === "write" && (!exactKeys(value,["outcome","metadata","atomic"]) || value.outcome !== "written" || typeof value.atomic !== "boolean" || !metadata(value.metadata))) throw new Error("provider returned an invalid write result");
    else if (operation === "createDirectory" && (!exactKeys(value,["outcome","path"]) || value.outcome !== "created" || !boundedText(value.path,4096))) throw new Error("provider returned an invalid create result");
    else if (operation === "rename" && (!exactKeys(value,["outcome","from","to"]) || value.outcome !== "renamed" || !boundedText(value.from,4096) || !boundedText(value.to,4096))) throw new Error("provider returned an invalid rename result");
    else if (operation === "remove" && (!exactKeys(value,["outcome","path"]) || value.outcome !== "removed" || !boundedText(value.path,4096))) throw new Error("provider returned an invalid remove result");
  } else if (capability === "filesystem-observation") {
    if (operation === "observe" && (!exactKeys(value,["observationId","mode","minimumPollMs","state","root"]) || !boundedId(value.observationId) || value.mode !== "bounded-polling" || !positive(value.minimumPollMs) || value.state !== "resync-required" || !boundedText(value.root,4096))) throw new Error("provider returned an invalid filesystem observation");
    else if (operation === "poll" && !filesystemObservationPoll(value)) throw new Error("provider returned an invalid filesystem observation poll");
    else if (operation === "stop" && (!exactKeys(value,["observationId","stopped"]) || !boundedId(value.observationId) || value.stopped !== true)) throw new Error("provider returned an invalid filesystem observation stop");
    else if (operation === "manualRefresh" && (!exactKeys(value,["observationId","accepted","state"]) || !boundedId(value.observationId) || value.accepted !== true || value.state !== "resync-required")) throw new Error("provider returned an invalid filesystem refresh");
    else if (!["observe","poll","stop","manualRefresh"].includes(String(operation))) throw new Error("provider returned an unknown filesystem observation operation");
  } else if (capability === "process-observation") {
    if (operation === "observe" && (!exactKeys(value,["observationId","protocol","version","state"]) || !boundedId(value.observationId) || value.protocol !== "terminay-target-helper/process-v1" || value.version !== 1 || value.state !== "starting")) throw new Error("provider returned an invalid process observation");
    else if (operation === "poll" && !processObservationPoll(value)) throw new Error("provider returned an invalid process observation poll");
    else if (operation === "stop" && (!exactKeys(value,["observationId","stopped"]) || !boundedId(value.observationId) || value.stopped !== true)) throw new Error("provider returned an invalid process observation stop");
    else if (!["observe","poll","stop"].includes(String(operation))) throw new Error("provider returned an unknown process observation operation");
  } else if (capability === "git") {
    if (!["discover","status","branches","worktrees","diff","fetch","quickPush","cancel"].includes(String(operation)) || !gitServiceResult(String(operation), value)) throw new Error("provider returned an invalid Git service result");
  } else throw new Error("provider returned an unsupported service capability");
  const encoded = JSON.stringify(result);
  if (encoded === undefined || Buffer.byteLength(encoded) > 768 * 1024) throw new Error("provider returned an oversized service result");
  return structuredClone(result);
}
function base64(value: string): boolean { try { return Buffer.from(value,"base64").toString("base64") === value; } catch { return false; } }
function exactKeys(value: Record<string,unknown>, allowed: string[]): boolean { return Object.keys(value).every((key)=>allowed.includes(key)); }
function boundedText(value: unknown,max:number): value is string { return typeof value === "string" && value.length>0 && value.length<=max && !value.includes("\0"); }
function positive(value:unknown):boolean{return Number.isSafeInteger(value)&&Number(value)>0;}
function metadata(value:unknown):boolean{const item=record(value);return item!==undefined&&exactKeys(item,["path","size","mode","mtimeMs","atimeMs","type"])&&(item.path===undefined||boundedText(item.path,4096))&&Number.isFinite(item.size)&&Number(item.size)>=0&&Number.isFinite(item.mode)&&Number.isFinite(item.mtimeMs)&&Number.isFinite(item.atimeMs)&&["directory","symlink","file"].includes(String(item.type));}
function terminalExit(value:unknown):boolean{const item=record(value);return item!==undefined&&exactKeys(item,["code","signal","interrupted","reason"])&&(item.code===null||Number.isInteger(item.code))&&(item.signal===null||boundedText(item.signal,64))&&typeof item.interrupted==="boolean"&&(item.reason===undefined||item.reason==="transport-lost");}
function filesystemObservationPoll(value:Record<string,unknown>):boolean{if(!exactKeys(value,["observationId","state","revision","events","root","manualRefreshAvailable","reason"])||!boundedId(value.observationId)||!["resync","changes","coalesced","degraded"].includes(String(value.state))||!Number.isSafeInteger(value.revision)||Number(value.revision)<0||!Array.isArray(value.events)||value.events.length>1000)return false;if(value.root!==undefined&&!boundedText(value.root,4096))return false;if(value.manualRefreshAvailable!==undefined&&typeof value.manualRefreshAvailable!=="boolean")return false;if(value.reason!==undefined&&!boundedText(value.reason,1000))return false;return value.events.every((entry)=>{const event=record(entry);return event!==undefined&&exactKeys(event,["kind","path"])&&["created","changed","removed"].includes(String(event.kind))&&boundedText(event.path,4096);});}
function processObservationPoll(value:Record<string,unknown>):boolean{if(!exactKeys(value,["observationId","state","cwd","foregroundProcess","observedAt","lastObservedAt","reason"])||!boundedId(value.observationId)||!["available","stale","unavailable","starting"].includes(String(value.state)))return false;if(value.state==="available")return boundedText(value.cwd,4096)&&(value.foregroundProcess===null||boundedText(value.foregroundProcess,512))&&Number.isFinite(value.observedAt);if(value.reason!==undefined&&!boundedText(value.reason,256))return false;return value.cwd===null&&value.foregroundProcess===null&&(value.lastObservedAt===undefined||Number.isFinite(value.lastObservedAt));}
function gitServiceResult(operation:string,value:Record<string,unknown>):boolean{
  if(operation==="discover")return exactKeys(value,["state","repositoryRoot","repositoryId","worktreeId"])&&["ready","not-repository","git-unavailable"].includes(String(value.state))&&(value.repositoryRoot===null||boundedText(value.repositoryRoot,4096))&&(value.repositoryId===null||Boolean(boundedId(value.repositoryId)))&&(value.worktreeId===null||Boolean(boundedId(value.worktreeId)));
  if(operation==="status")return exactKeys(value,["state","repositoryRoot","repositoryId","worktreeId","branch","head","entries","bounded"])&&typeof value.bounded==="boolean"&&Array.isArray(value.entries)&&value.entries.length<=10000;
  if(operation==="branches")return exactKeys(value,["branches","bounded"])&&typeof value.bounded==="boolean"&&Array.isArray(value.branches)&&value.branches.length<=4096;
  if(operation==="worktrees")return exactKeys(value,["worktrees","bounded"])&&typeof value.bounded==="boolean"&&Array.isArray(value.worktrees)&&value.worktrees.length<=256;
  if(operation==="diff")return exactKeys(value,["patch","bounded","binary"])&&typeof value.patch==="string"&&Buffer.byteLength(value.patch)<=4*1024*1024&&typeof value.bounded==="boolean"&&typeof value.binary==="boolean";
  if(operation==="fetch")return exactKeys(value,["applied","head","detail"])&&value.applied===true&&boundedText(value.head,256)&&typeof value.detail==="string"&&value.detail.length<=2048;
  if(operation==="quickPush")return exactKeys(value,["proposalId","head","actions","expiresAt"])||exactKeys(value,["applied","completed","head"]);
  return false;
}
function hasExecutable(value: unknown, seen = new Set<unknown>()): boolean {
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint" || value === undefined) return true;
  if (value === null || typeof value !== "object") return false;
  if (seen.has(value)) return true; seen.add(value);
  if (Object.getPrototypeOf(value) !== Object.prototype && !Array.isArray(value)) return true;
  return Object.values(value as Record<string, unknown>).some((item) => hasExecutable(item, seen));
}
function validated<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }, message: string): T { if (!result.ok) throw new Error(message); return structuredClone(result.value); }
