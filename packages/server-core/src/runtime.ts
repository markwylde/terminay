import type { ProtocolId } from "@terminay/protocol";
import type { MacroTarget } from "./macroService/types.js";
import type { ServerSettingsRepository } from "./settings/repository.js";
import type { ServerVaultService, VaultStatus } from "./settings/vault.js";
import type { ExtensionSecretBroker } from "./settings/extensionSecretBroker.js";
import type { RemoteExposureService } from "./remote/exposure.js";
import type { AgentStatusService } from "./activity/agentService.js";
import type { TerminalActivityService } from "./activity/service.js";
import { validateServerPlatformPaths, type ServerPlatformPaths } from "./platform.js";
import type { TerminalInputSourceAdapter, TerminalService, TerminalServiceAdapter } from "./terminalService/index.js";
import type { ExtensionHostManager } from "./extensions/manager.js";

export type ServerRuntimeMode = "embedded" | "standalone";
export type RuntimePhase = "created" | "starting" | "ready" | "stopping" | "stopped" | "failed";

export interface ServerRuntimeConfig {
  readonly serverId: ProtocolId;
  readonly serverVersion: string;
  readonly dataRoot: string;
  /** Host-injected paths used to compose server-owned services. */
  readonly platformPaths?: ServerPlatformPaths;
  readonly runtimeMode: ServerRuntimeMode;
  readonly logSink?: string;
  readonly uiBundle?: string;
  readonly localEndpoint?: string;
  readonly shutdownTimeoutMs?: number;
  /** Server-owned state services. Values never cross this config boundary. */
  readonly services?: ServerRuntimeServices;
}

export interface ServerRuntimeServices {
  /** Server-owned canonical terminal activity and provider agent state. */
  readonly activity?: TerminalActivityService;
  readonly agents?: AgentStatusService;
  readonly settings?: ServerSettingsRepository;
  readonly vault?: ServerVaultService;
  /** Same server-owned scoped broker in embedded and standalone modes. */
  readonly extensionSecrets?: ExtensionSecretBroker;
  /** Fault-isolated server-side extension processes. */
  readonly extensionHosts?: ExtensionHostManager;
  /** Server-owned PTY authority. Client disconnects never stop this service. */
  readonly terminal?: TerminalService;
  /** Optional protocol-facing adapters composed around the PTY authority. */
  readonly terminalAdapter?: TerminalServiceAdapter;
  readonly terminalInputSources?: TerminalInputSourceAdapter;
  /** Server-owned remote exposure lifecycle; credentials remain inside the controller. */
  readonly remoteExposure?: RemoteExposureService;
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
  readonly remoteExposure?: {
    readonly state: "disabled" | "exposed";
    readonly roomId: ProtocolId | null;
    readonly expiresAt: string | null;
    readonly connectedPeers: number;
  };
  readonly terminal?: {
    readonly sessions: number;
    readonly runningSessions: number;
  };
}

/** Electron-free lifecycle composition shared by embedded and foreground
 * launches. Paths and service constructors are injected by the host. */
export class ServerRuntime {
  private phase: RuntimePhase = "created";
  private startedAt = 0;
  private startPromise: Promise<RuntimeHealth> | undefined;
  private stopPromise: Promise<void> | undefined;
  readonly config: ServerRuntimeConfig;
  readonly services: ServerRuntimeServices;

  constructor(config: ServerRuntimeConfig, private readonly hooks: ServerRuntimeHooks = {}) {
    if (!/^[-A-Za-z0-9._:]{1,128}$/.test(config.serverId)) throw new TypeError("invalid server id");
    if (config.dataRoot.length === 0 || config.dataRoot.length > 4096) throw new TypeError("invalid data root");
    if (config.shutdownTimeoutMs !== undefined && (!Number.isSafeInteger(config.shutdownTimeoutMs) || config.shutdownTimeoutMs < 0)) throw new RangeError("invalid shutdown timeout");
    const platformPaths = config.platformPaths === undefined
      ? undefined
      : validateServerPlatformPaths(config.platformPaths, config.dataRoot);
    const normalizedConfig: ServerRuntimeConfig = platformPaths === undefined
      ? config
      : { ...config, platformPaths };
    this.services = Object.freeze(normalizedConfig.services === undefined ? {} : { ...normalizedConfig.services });
    // Keep service instances out of the public config object. A host may log
    // or serialize config for readiness diagnostics; service adapters can own
    // key material and must remain reachable only through this runtime.
    const { services: _services, ...publicConfig } = normalizedConfig;
    void _services;
    this.config = Object.freeze(publicConfig);
  }

  get state(): RuntimePhase { return this.phase; }
  async start(): Promise<RuntimeHealth> {
    if (this.phase === "ready") return this.health();
    if (this.phase === "starting" && this.startPromise !== undefined) return this.startPromise;
    if (this.phase !== "created") throw new Error(`server runtime is ${this.phase}`);
    this.phase = "starting";
    this.startPromise = (async () => {
      try {
        await this.services.agents?.start();
        await this.hooks.startServices?.(this.config, this.services);
        if (this.phase === "starting") {
          this.startedAt = Date.now();
          this.phase = "ready";
        }
        return this.health();
      }
      catch (error) {
        if (this.phase === "starting") this.phase = "failed";
        try {
          await this.services.vault?.restartLock();
        } catch (lockError) {
          throw new AggregateError([error, lockError], "server startup and vault fencing failed");
        }
        throw error;
      }
    })();
    return this.startPromise;
  }

  async stop(): Promise<void> {
    if (this.phase === "stopped") return;
    if (this.stopPromise !== undefined) return this.stopPromise;
    this.phase = "stopping"; const deadline = Date.now() + (this.config.shutdownTimeoutMs ?? 5_000);
    const stopWork = (async (): Promise<void> => {
	  // Do not let a deferred startup bind a service after teardown. `start()`
	  // observes the stopping phase and cannot publish readiness.
	  await this.startPromise?.catch(() => undefined);
      const failures: unknown[] = [];
      const attempt = async (operation: () => Promise<unknown> | unknown): Promise<void> => {
        try { await operation(); } catch (error) { failures.push(error); }
      };
      // Exposure must be withdrawn even before a failed/unfinished start.
      await attempt(() => this.services.remoteExposure?.shutdown());
      // Terminal exit emits final lifecycle facts; stop agents only afterwards.
      await attempt(() => this.services.terminal?.shutdown());
      await attempt(() => this.services.agents?.stop());
      await attempt(() => this.services.extensionHosts?.shutdown());
      await attempt(() => this.hooks.stopServices?.(deadline, this.services));
      // Extension/service teardown runs before the vault is fenced so its
      // bounded shutdown callbacks can finish. Regardless of teardown
      // failures, discard all in-memory vault key material before stop ends.
      await attempt(() => this.services.vault?.restartLock());
      if (failures.length > 0) throw cleanupFailure("server runtime shutdown failed", failures);
    })();
    const timeoutMs = this.config.shutdownTimeoutMs ?? 5_000;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => { timeoutHandle = setTimeout(resolve, timeoutMs); });
    this.stopPromise = Promise.race([stopWork, timeout]).then(() => {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      this.phase = "stopped";
    }, (error) => {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      this.phase = "stopped";
      throw error;
    });
    return this.stopPromise;
  }

  health(): RuntimeHealth { return { phase: this.phase, serverId: this.config.serverId, version: this.config.serverVersion, ready: this.phase === "ready", uptimeMs: this.startedAt === 0 ? 0 : Math.max(0, Date.now() - this.startedAt) }; }

  diagnostics(): RuntimeDiagnostics {
    const settingsRevision = readSettingsRevision(this.services.settings);
    const vault = this.services.vault?.status();
    const remoteStatus = this.services.remoteExposure?.status;
    const remoteExposure = remoteStatus === undefined
      ? undefined
      : {
          state: remoteStatus.exposure.state,
          roomId: remoteStatus.exposure.roomId ?? null,
          expiresAt: remoteStatus.exposure.expiresAt === undefined ? null : new Date(remoteStatus.exposure.expiresAt).toISOString(),
          connectedPeers: remoteStatus.peers.filter((peer) => peer.state === "connected").length,
        };
    const terminalSessions = this.services.terminal?.listSessions();
    const terminal = terminalSessions === undefined
      ? undefined
      : {
          sessions: terminalSessions.length,
          runningSessions: terminalSessions.filter((session) => session.status === "running").length,
        };
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
      ...(remoteExposure === undefined ? {} : { remoteExposure }),
      ...(terminal === undefined ? {} : { terminal }),
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

function cleanupFailure(message: string, failures: readonly unknown[]): Error {
  const error = new Error(message);
  Object.defineProperty(error, "errors", { value: [...failures], enumerable: false });
  return error;
}

function readSettingsRevision(repository: ServerSettingsRepository | undefined): number | undefined {
  if (repository === undefined) return undefined;
  try { return repository.revision; } catch { return undefined; }
}

function sameTarget(left: MacroTarget, right: MacroTarget): boolean {
  return left.serverId === right.serverId && left.projectId === right.projectId && left.sessionId === right.sessionId;
}
