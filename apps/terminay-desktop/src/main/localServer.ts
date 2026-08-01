import type { EmbeddedLocalServer, LocalServerReadiness, LocalServerState } from "./connectionHost.js";

export type DesktopLocalLifecyclePolicy = "application" | "last-window";

const DEFAULT_BOOTSTRAP_CREDENTIAL_TTL_MS = 30_000;
const MAX_BOOTSTRAP_CREDENTIAL_TTL_MS = 5 * 60_000;

export interface DesktopLocalBootstrapCredential {
  readonly value: string;
  readonly expiresAt: number;
}

/**
 * Private parent/child channel used while composing the embedded Local
 * authority. The credential is claimable once and is never placed in a
 * profile, state snapshot, or serialized connection record.
 */
export interface DesktopLocalBootstrapChannel {
  readonly expiresAt: number;
  claim(): DesktopLocalBootstrapCredential;
}

class PrivateDesktopLocalBootstrapChannel implements DesktopLocalBootstrapChannel {
  private claimed = false;
  private closed = false;
  private readonly credential = createRandomCredential();

  constructor(readonly expiresAt: number) {}

  claim(): DesktopLocalBootstrapCredential {
    if (this.closed) throw new Error("Local bootstrap channel is closed");
    if (this.claimed) throw new Error("Local bootstrap credential was already claimed");
    if (Date.now() >= this.expiresAt) throw new Error("Local bootstrap credential expired");
    this.claimed = true;
    return Object.freeze({ value: this.credential, expiresAt: this.expiresAt });
  }

  verify(readiness: LocalServerReadiness): void {
    if (!this.claimed) throw new Error("Local server did not claim the private bootstrap credential");
    if (this.closed) throw new Error("Local bootstrap channel is closed");
    if (Date.now() >= this.expiresAt) throw new Error("Local bootstrap credential expired");
    if (readiness.bootstrapCredential !== this.credential || readiness.bootstrapCredentialExpiresAt !== this.expiresAt) {
      throw new Error("Local server readiness does not prove the private bootstrap credential");
    }
  }

  close(): void {
    this.closed = true;
  }
}

function createRandomCredential(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

export type DesktopLocalLifecycleEvent =
  | { readonly type: "renderer-reload" }
  | { readonly type: "window-closed"; readonly remainingWindows: number }
  | { readonly type: "application-quit" };

export interface DesktopLocalServerSupervisorOptions {
  /** Creates the one server authority only when the supervisor first starts. */
  readonly create: (bootstrap: DesktopLocalBootstrapChannel) => EmbeddedLocalServer;
  /** Controls whether Local outlives the last native window. */
  readonly lifecyclePolicy?: DesktopLocalLifecyclePolicy;
  /** Lifetime of the parent/child bootstrap credential. */
  readonly bootstrapCredentialTtlMs?: number;
}

/**
 * Desktop-owned Local lifecycle boundary.
 *
 * The supervisor is deliberately separate from window/renderer lifetime. It
 * coalesces concurrent start calls, creates one child authority, and requires
 * an explicit restart after failure. A renderer reload therefore cannot
 * accidentally create a second Local server over the same data root.
 */
export class DesktopLocalServerSupervisor implements EmbeddedLocalServer {
  private stateValue: LocalServerState = "created";
  private child: EmbeddedLocalServer | undefined;
  private readiness: LocalServerReadiness | undefined;
  private startPromise: Promise<LocalServerReadiness> | undefined;
  private stopPromise: Promise<void> | undefined;
  private unsubscribeChild: (() => void) | undefined;
  private readonly listeners = new Set<(state: LocalServerState) => void>();
  readonly lifecyclePolicy: DesktopLocalLifecyclePolicy;
  readonly bootstrapCredentialTtlMs: number;

  constructor(private readonly options: DesktopLocalServerSupervisorOptions) {
    if (typeof options.create !== "function") throw new TypeError("Local server factory is required");
    this.lifecyclePolicy = options.lifecyclePolicy ?? "application";
    if (this.lifecyclePolicy !== "application" && this.lifecyclePolicy !== "last-window") {
      throw new TypeError("Local server lifecycle policy must be application or last-window");
    }
    this.bootstrapCredentialTtlMs = options.bootstrapCredentialTtlMs ?? DEFAULT_BOOTSTRAP_CREDENTIAL_TTL_MS;
    if (!Number.isSafeInteger(this.bootstrapCredentialTtlMs) || this.bootstrapCredentialTtlMs <= 0 || this.bootstrapCredentialTtlMs > MAX_BOOTSTRAP_CREDENTIAL_TTL_MS) {
      throw new RangeError("Local bootstrap credential TTL must be a positive safe integer no greater than five minutes");
    }
  }

  get state(): LocalServerState { return this.stateValue; }

  onStateChange(listener: (state: LocalServerState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): Promise<LocalServerReadiness> {
    if (this.stateValue === "ready" && this.readiness !== undefined) return Promise.resolve(this.readiness);
    if (this.startPromise !== undefined) return this.startPromise;
    if (this.stateValue === "starting" || this.stateValue === "restarting") throw new Error("Local server start is already in progress");
    if (this.stateValue === "stopping") throw new Error("Local server is stopping");
    if (this.stateValue === "crashed" || this.stateValue === "failed") throw new Error("Local server requires explicit restart");
    this.setState("starting");
    this.startPromise = this.startChild().finally(() => { this.startPromise = undefined; });
    return this.startPromise;
  }

  async restart(): Promise<LocalServerReadiness> {
    if (this.stateValue !== "crashed" && this.stateValue !== "failed" && this.stateValue !== "stopped") throw new Error(`Local server cannot restart from ${this.stateValue}`);
    await this.stop();
    return this.start();
  }

  stop(): Promise<void> {
    if (this.stopPromise !== undefined) return this.stopPromise;
    this.stopPromise = (async () => {
      if (this.startPromise !== undefined) await this.startPromise.catch(() => undefined);
      const child = this.child;
      this.setState("stopping");
      await child?.stop().catch(() => undefined);
      this.unsubscribeChild?.();
      this.unsubscribeChild = undefined;
      this.child = undefined;
      this.readiness = undefined;
      this.setState("stopped");
    })().finally(() => { this.stopPromise = undefined; });
    return this.stopPromise;
  }

  /**
   * Apply native Desktop lifecycle signals without coupling the authority to
   * a BrowserWindow or renderer id. Reload is deliberately a no-op. A window
   * close only stops Local under the explicit last-window policy; application
   * quit always owns the final shutdown.
   */
  async handleLifecycle(event: DesktopLocalLifecycleEvent): Promise<void> {
    if (event.type === "renderer-reload") return;
    if (event.type === "application-quit") {
      await this.stop();
      return;
    }
    if (!Number.isSafeInteger(event.remainingWindows) || event.remainingWindows < 0) {
      throw new RangeError("remainingWindows must be a non-negative safe integer");
    }
    if (this.lifecyclePolicy === "last-window" && event.remainingWindows === 0) {
      await this.stop();
    }
  }

  private async startChild(): Promise<LocalServerReadiness> {
    const bootstrap = new PrivateDesktopLocalBootstrapChannel(Date.now() + this.bootstrapCredentialTtlMs);
    try {
      const child = this.options.create(bootstrap);
      if (child === null || typeof child !== "object" || typeof child.start !== "function" || typeof child.stop !== "function") throw new TypeError("Local server factory returned an invalid authority");
      this.child = child;
      this.unsubscribeChild = child.onStateChange?.((state) => {
        // Preserve bootstrap progress (especially migration) across the
        // Desktop boundary. The host must not display a connected workspace
        // while the embedded authority is changing state.
        if (state !== "created") this.setState(state);
      });
      const readiness = await child.start();
      bootstrap.verify(readiness);
      if (this.stateValue === "crashed" || this.stateValue === "failed" || this.stateValue === "stopped") throw new Error(`Local server became ${this.stateValue} during startup`);
      this.readiness = Object.freeze({ ...readiness });
      this.setState("ready");
      return this.readiness;
    } catch (error) {
      bootstrap.close();
      this.setState("failed");
      throw error;
    } finally {
      bootstrap.close();
    }
  }

  private setState(state: LocalServerState): void {
    if (this.stateValue === state) return;
    this.stateValue = state;
    for (const listener of this.listeners) listener(state);
  }
}

export function createDesktopLocalServerSupervisor(options: DesktopLocalServerSupervisorOptions): DesktopLocalServerSupervisor {
  return new DesktopLocalServerSupervisor(options);
}
