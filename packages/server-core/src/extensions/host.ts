import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isChildFrame, frameByteLength, EXTENSION_HOST_PROTOCOL_VERSION, type ChildFrame, type HostFrame } from "./protocol.js";
import { validateExtensionLaunchDescriptor } from "./descriptor.js";
import type { ExtensionBroker, ExtensionHostLimits, ExtensionHostStatus, ExtensionInvocation, ExtensionLaunchDescriptor } from "./types.js";
import { isNamespacedId, validateDeclarativeForm, type ProviderDefinition } from "@terminay/extension-api";

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
  private stopping = false;
  private providers: readonly ProviderDefinition[] = Object.freeze([]);
  private readonly limits: Required<ExtensionHostLimits>;
  private readonly now: () => number;

  constructor(readonly extensionId: string, private readonly options: ExtensionHostOptions) {
    this.limits = { ...DEFAULTS, ...options.limits };
    this.now = options.now ?? Date.now;
    this.state = { extensionId, state: "stopped", consecutiveCrashes: 0 };
  }

  status(): ExtensionHostStatus { return Object.freeze({ ...this.state, providers: this.providers }); }

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
      env: { NODE_ENV: "production", TERMINAY_EXTENSION_HOST: "1" },
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
      }, this.limits.startupTimeoutMs, undefined, true);
      this.providers = validateProviders(record(activated)?.providers, this.extensionId);
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

  async stop(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    if (child === undefined) {
      this.state = { extensionId: this.extensionId, state: "stopped", consecutiveCrashes: this.state.consecutiveCrashes };
      return;
    }
    try { await this.call("deactivate", undefined, this.limits.shutdownTimeoutMs); } catch { /* bounded forced termination below */ }
    this.terminateChild();
    this.rejectPending(new Error("extension host stopped"));
    this.state = { extensionId: this.extensionId, state: "stopped", consecutiveCrashes: this.state.consecutiveCrashes };
    this.providers = Object.freeze([]);
  }

  clearQuarantine(): void {
    if (this.child !== undefined) throw new Error("cannot clear quarantine while extension is running");
    this.crashTimes.length = 0;
    this.state = { extensionId: this.extensionId, state: "stopped", consecutiveCrashes: 0 };
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
    if (message.kind === "ready" || message.kind === "result" || message.kind === "deactivated") this.finishPending(message.id, message.payload);
    else this.finishPending(message.id, undefined, new Error(failureMessage(message.payload)));
  }

  private async handleBrokerRequest(frame: ChildFrame): Promise<void> {
    if (this.activeBrokerCalls.size >= this.limits.maxConcurrentInvocations) { this.sendBrokerResult(frame.id, undefined, "broker admission limit reached"); return; }
    const payload = record(frame.payload);
    const operation = payload?.operation;
    if (operation !== "log" && operation !== "secret.resolve" && operation !== "provider.call") { this.sendBrokerResult(frame.id, undefined, "unsupported broker operation"); return; }
    const controller = new AbortController(); this.activeBrokerCalls.set(frame.id, controller);
    try {
      const result = await this.options.broker.request({ extensionId: this.extensionId, operation, payload: payload?.payload }, controller.signal);
      this.sendBrokerResult(frame.id, result);
    } catch (error) { this.sendBrokerResult(frame.id, undefined, error instanceof Error ? error.message : "broker request failed"); }
    finally { this.activeBrokerCalls.delete(frame.id); }
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
    if (!this.stopping && this.state.state !== "failed" && this.state.state !== "quarantined") this.recordFailure(new Error(`extension child exited (${code ?? signal ?? "unknown"})`));
  }

  private recordFailure(error: Error): void {
    const now = this.now(); this.crashTimes.push(now);
    while ((this.crashTimes[0] ?? now) < now - this.limits.crashWindowMs) this.crashTimes.shift();
    const crashes = this.crashTimes.length;
    this.rejectPending(error);
    this.providers = Object.freeze([]);
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
function validateProviders(value: unknown, extensionId: string): readonly ProviderDefinition[] {
  if (!Array.isArray(value) || value.length > 32) throw new Error("extension returned invalid provider registrations");
  const seen = new Set<string>();
  const providers: ProviderDefinition[] = [];
  for (const item of value) {
    const provider = record(item);
    if (provider === undefined || typeof provider.providerId !== "string" || !isNamespacedId(provider.providerId, extensionId) || seen.has(provider.providerId)
      || typeof provider.displayName !== "string" || provider.displayName.length === 0 || provider.displayName.length > 96
      || !Array.isArray(provider.capabilities) || provider.capabilities.length === 0) throw new Error("extension returned invalid provider registrations");
    for (const form of [provider.profileForm, provider.createForm]) {
      if (form !== undefined && !validateDeclarativeForm(form).ok) throw new Error("extension returned an invalid declarative form");
    }
    seen.add(provider.providerId);
    providers.push(structuredClone(item) as ProviderDefinition);
  }
  return Object.freeze(providers);
}
