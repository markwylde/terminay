import type { ProtocolId } from "@terminay/protocol";
import type { MacroTarget } from "./macroService/types.js";
import type { ServerSettingsRepository } from "./settings/repository.js";
import type { ServerVaultService, VaultStatus } from "./settings/vault.js";

export type ServerRuntimeMode = "embedded" | "standalone";
export type RuntimePhase = "created" | "starting" | "ready" | "stopping" | "stopped" | "failed";

export interface ServerRuntimeConfig {
  readonly serverId: ProtocolId;
  readonly serverVersion: string;
  readonly dataRoot: string;
  readonly runtimeMode: ServerRuntimeMode;
  readonly logSink?: string;
  readonly uiBundle?: string;
  readonly localEndpoint?: string;
  readonly shutdownTimeoutMs?: number;
  /** Server-owned state services. Values never cross this config boundary. */
  readonly services?: ServerRuntimeServices;
}

export interface ServerRuntimeServices {
  readonly settings?: ServerSettingsRepository;
  readonly vault?: ServerVaultService;
}

export interface ServerRuntimeHooks {
  readonly startServices?: (config: ServerRuntimeConfig, services?: ServerRuntimeServices) => void | Promise<void>;
  readonly stopServices?: (deadline: number, services?: ServerRuntimeServices) => void | Promise<void>;
}

export interface RuntimeHealth { readonly phase: RuntimePhase; readonly serverId: ProtocolId; readonly version: string; readonly ready: boolean; readonly uptimeMs: number; }
export interface RuntimeDiagnostics {
  readonly phase: RuntimePhase;
  readonly serverId: ProtocolId;
  readonly version: string;
  readonly runtimeMode: ServerRuntimeMode;
  readonly dataRootConfigured: boolean;
  readonly uiBundleConfigured: boolean;
  readonly localEndpointConfigured: boolean;
  /** Revision and vault metadata are safe to expose; values are never present. */
  readonly settingsRevision?: number;
  readonly vault?: VaultStatus;
}

/** Electron-free lifecycle composition shared by embedded and foreground
 * launches. Paths and service constructors are injected by the host. */
export class ServerRuntime {
  private phase: RuntimePhase = "created";
  private startedAt = 0;
  private stopPromise: Promise<void> | undefined;
  readonly config: ServerRuntimeConfig;
  readonly services: ServerRuntimeServices;

  constructor(config: ServerRuntimeConfig, private readonly hooks: ServerRuntimeHooks = {}) {
    if (!/^[-A-Za-z0-9._:]{1,128}$/.test(config.serverId)) throw new TypeError("invalid server id");
    if (config.dataRoot.length === 0 || config.dataRoot.length > 4096) throw new TypeError("invalid data root");
    if (config.shutdownTimeoutMs !== undefined && (!Number.isSafeInteger(config.shutdownTimeoutMs) || config.shutdownTimeoutMs < 0)) throw new RangeError("invalid shutdown timeout");
    this.services = Object.freeze(config.services === undefined ? {} : { ...config.services });
    // Keep service instances out of the public config object. A host may log
    // or serialize config for readiness diagnostics; service adapters can own
    // key material and must remain reachable only through this runtime.
    const { services: _services, ...publicConfig } = config;
    void _services;
    this.config = Object.freeze(publicConfig);
  }

  get state(): RuntimePhase { return this.phase; }
  async start(): Promise<RuntimeHealth> {
    if (this.phase === "ready") return this.health();
    if (this.phase !== "created") throw new Error(`server runtime is ${this.phase}`);
    this.phase = "starting";
    try { await this.hooks.startServices?.(this.config, this.services); this.startedAt = Date.now(); this.phase = "ready"; return this.health(); }
    catch (error) { this.phase = "failed"; throw error; }
  }

  async stop(): Promise<void> {
    if (this.phase === "stopped" || this.phase === "created") { this.phase = "stopped"; return; }
    if (this.stopPromise !== undefined) return this.stopPromise;
    this.phase = "stopping"; const deadline = Date.now() + (this.config.shutdownTimeoutMs ?? 5_000);
    const stopWork = Promise.resolve(this.hooks.stopServices?.(deadline, this.services));
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, this.config.shutdownTimeoutMs ?? 5_000));
    this.stopPromise = Promise.race([stopWork, timeout]).then(() => { this.phase = "stopped"; });
    return this.stopPromise;
  }

  health(): RuntimeHealth { return { phase: this.phase, serverId: this.config.serverId, version: this.config.serverVersion, ready: this.phase === "ready", uptimeMs: this.startedAt === 0 ? 0 : Math.max(0, Date.now() - this.startedAt) }; }

  diagnostics(): RuntimeDiagnostics {
    const settingsRevision = readSettingsRevision(this.services.settings);
    const vault = this.services.vault?.status();
    return {
      phase: this.phase,
      serverId: this.config.serverId,
      version: this.config.serverVersion,
      runtimeMode: this.config.runtimeMode,
      dataRootConfigured: this.config.dataRoot.length > 0,
      uiBundleConfigured: this.config.uiBundle !== undefined,
      localEndpointConfigured: this.config.localEndpoint !== undefined,
      ...(settingsRevision === undefined ? {} : { settingsRevision }),
      ...(vault === undefined ? {} : { vault }),
    };
  }

  /** Resolve a secret only for a server-owned callback (for example a macro
   * PTY writer or provider adapter). No transport DTO is created here. */
  withSecret<T>(id: string, callback: (secret: Uint8Array) => T | Promise<T>): Promise<T> {
    const vault = this.services.vault;
    if (vault === undefined) return Promise.reject(new Error("server vault is unavailable"));
    return vault.withSecret(id, callback);
  }

  /**
   * Build the server-side resolver consumed by MacroRunner. The requested
   * terminal identity must remain the exact identity selected when the run
   * was authorized; a renderer/window id cannot widen this scope.
   */
  createMacroSecretResolver(expectedTarget: MacroTarget): (target: MacroTarget, secretId: string) => Promise<Uint8Array> {
    if (expectedTarget.serverId !== this.config.serverId) throw new Error("macro target belongs to another server");
    return (target, secretId) => {
      if (!sameTarget(expectedTarget, target)) return Promise.reject(new Error("macro target authorization does not match the exact terminal"));
      return this.withSecret(secretId, (secret) => new Uint8Array(secret));
    };
  }
}

function readSettingsRevision(repository: ServerSettingsRepository | undefined): number | undefined {
  if (repository === undefined) return undefined;
  try { return repository.revision; } catch { return undefined; }
}

function sameTarget(left: MacroTarget, right: MacroTarget): boolean {
  return left.serverId === right.serverId && left.projectId === right.projectId && left.sessionId === right.sessionId;
}
