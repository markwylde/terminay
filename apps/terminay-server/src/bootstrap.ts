import { createHash, randomBytes } from "node:crypto";
import type { ServerRuntime, ServerRuntimeConfig, ServerRuntimeHooks } from "@terminay/server-core";
import { createEmbeddedServer } from "./index.js";
import type { LocalUiServer } from "./localUiServer.js";

export interface LocalEndpointCandidate {
  readonly origin: string;
  readonly endpoint: string;
}

export interface LocalEndpointAllocator {
  choose(): Promise<LocalEndpointCandidate> | LocalEndpointCandidate;
  claim(candidate: LocalEndpointCandidate): Promise<void> | void;
  release(candidate: LocalEndpointCandidate): Promise<void> | void;
}

export interface DataRootLease {
  acquire(dataRoot: string): Promise<void> | void;
  release(dataRoot: string): Promise<void> | void;
}

export interface EmbeddedBootstrapOptions extends Omit<ServerRuntimeConfig, "runtimeMode" | "localEndpoint"> {
  readonly allocator: LocalEndpointAllocator;
  readonly dataRootLease: DataRootLease;
  /**
   * When Desktop supervises Local, the parent mints this credential on its
   * private one-time bootstrap channel.  Standalone embedded uses continue to
   * mint an authority-local credential here.  In either case it is listener
   * authentication only, never a profile or URL value.
   */
  readonly bootstrapCredential?: string;
  readonly hooks?: ServerRuntimeHooks;
  /**
   * Optional factory for the authenticated responsive workspace host.  It is
   * deliberately composed here, beside `createEmbeddedServer`, so Desktop
   * Local uses the same runtime and UI server as a standalone launch instead
   * of acquiring an Electron-only web host.
   */
  readonly createUiServer?: (input: EmbeddedUiServerInput) => LocalUiServer;
  readonly publishReady?: (ready: EmbeddedBootstrapReady) => Promise<void> | void;
}

export interface EmbeddedUiServerInput {
  readonly serverId: string;
  readonly serverVersion: string;
  readonly endpoint: LocalEndpointCandidate;
  /** Private bootstrap credential; use it only as the listener credential. */
  readonly bootstrapCredential: string;
}

export interface EmbeddedBootstrapReady {
  readonly serverId: string;
  readonly serverVersion: string;
  readonly endpoint: string;
  readonly origin: string;
  /** The credential is delivered through the private parent/child callback only. */
  readonly bootstrapCredential: string;
  readonly credentialDigest: string;
}

export type EmbeddedBootstrapPhase = "created" | "starting" | "ready" | "failed" | "stopped";

/**
 * Coordinates one embedded Local authority. The allocator and data-root lease
 * are injected so Electron owns platform details while server composition
 * remains testable and Electron-free.
 */
export class EmbeddedServerBootstrap {
  private phaseValue: EmbeddedBootstrapPhase = "created";
  private runtimeValue: ServerRuntime | undefined;
  private candidateValue: LocalEndpointCandidate | undefined;
  private credentialValue: string | undefined;
  private leaseHeld = false;
  private startPromise: Promise<EmbeddedBootstrapReady> | undefined;
  private stopPromise: Promise<void> | undefined;

  constructor(private readonly options: EmbeddedBootstrapOptions) {
    if (!options.dataRoot || options.dataRoot.length > 4096) throw new TypeError("dataRoot is invalid");
    if (options.bootstrapCredential !== undefined && !isBootstrapCredential(options.bootstrapCredential)) {
      throw new TypeError("embedded bootstrap credential is invalid");
    }
  }

  get phase(): EmbeddedBootstrapPhase { return this.phaseValue; }
  get runtime(): ServerRuntime | undefined { return this.runtimeValue; }

  async start(): Promise<EmbeddedBootstrapReady> {
    if (this.phaseValue === "ready" && this.runtimeValue !== undefined && this.candidateValue !== undefined && this.credentialValue !== undefined) {
      return this.ready(this.candidateValue, this.credentialValue);
    }
    // Desktop can receive overlapping open/retry requests while its renderer
    // is reconnecting. They must observe one authority claim and one private
    // credential, rather than racing each other into a second Local runtime.
    if (this.startPromise !== undefined) return this.startPromise;
    // A deliberate stop releases the endpoint/data-root lease. Recovery is an
    // explicit new authority claim, never an implicit second runtime.
    if (this.phaseValue === "stopped" || this.phaseValue === "failed") this.phaseValue = "created";
    if (this.phaseValue !== "created") throw new Error(`embedded bootstrap is ${this.phaseValue}`);
    const startPromise = this.startOnce();
    this.startPromise = startPromise;
    try {
      return await startPromise;
    } finally {
      if (this.startPromise === startPromise) this.startPromise = undefined;
    }
  }

  private async startOnce(): Promise<EmbeddedBootstrapReady> {
    this.phaseValue = "starting";
    let candidate: LocalEndpointCandidate | undefined;
    let candidateClaimAttempted = false;
    try {
      await this.options.dataRootLease.acquire(this.options.dataRoot);
      this.leaseHeld = true;
      candidate = validateLoopbackCandidate(await this.options.allocator.choose());
      candidateClaimAttempted = true;
      await this.options.allocator.claim(candidate);
      this.candidateValue = candidate;
      const credential = this.options.bootstrapCredential ?? randomBytes(32).toString("base64url");
      this.credentialValue = credential;
      const { allocator: _allocator, dataRootLease: _dataRootLease, publishReady: _publishReady, bootstrapCredential: _bootstrapCredential, hooks, createUiServer, ...config } = this.options;
      void _allocator;
      void _dataRootLease;
      void _publishReady;
      void _bootstrapCredential;
      const uiServer = createUiServer?.(Object.freeze({
        serverId: config.serverId,
        serverVersion: config.serverVersion,
        endpoint: candidate,
        bootstrapCredential: credential,
      }));
      if (uiServer !== undefined && (typeof uiServer.start !== "function" || typeof uiServer.stop !== "function")) {
        throw new TypeError("embedded UI server factory returned an invalid listener");
      }
      const runtime = createEmbeddedServer({
        ...config,
        localEndpoint: candidate.endpoint,
        ...(hooks === undefined ? {} : { hooks }),
        ...(uiServer === undefined ? {} : { uiServer }),
      });
      this.runtimeValue = runtime;
      await runtime.start();
      if (uiServer !== undefined && uiServer.address?.origin !== candidate.origin) {
        throw new Error("embedded UI server did not bind the selected local endpoint");
      }
      this.phaseValue = "ready";
      const ready = this.ready(candidate, credential);
      await this.options.publishReady?.(ready);
      return ready;
    } catch (error) {
      this.phaseValue = "failed";
      await this.runtimeValue?.stop().catch(() => undefined);
      if (candidate !== undefined && candidateClaimAttempted) await Promise.resolve(this.options.allocator.release(candidate)).catch(() => undefined);
      if (this.leaseHeld) await Promise.resolve(this.options.dataRootLease.release(this.options.dataRoot)).catch(() => undefined);
      this.leaseHeld = false;
      this.candidateValue = undefined;
      this.runtimeValue = undefined;
      this.credentialValue = undefined;
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.phaseValue === "stopped") return;
    // A Desktop close can race its initial Local startup.  Joining that start
    // before tearing down prevents `stop()` from returning while the in-flight
    // bootstrap later publishes a live listener and lease.
    if (this.stopPromise !== undefined) return this.stopPromise;
    const stopPromise = this.stopOnce();
    this.stopPromise = stopPromise;
    try {
      await stopPromise;
    } finally {
      if (this.stopPromise === stopPromise) this.stopPromise = undefined;
    }
  }

  private async stopOnce(): Promise<void> {
    const starting = this.startPromise;
    if (starting !== undefined) await starting.catch(() => undefined);
    if (this.phaseValue === "stopped") return;

    let runtimeFailure: unknown;
    try {
      await this.runtimeValue?.stop();
    } catch (error) {
      runtimeFailure = error;
    }
    let endpointFailure: unknown;
    try {
      if (this.candidateValue !== undefined) await this.options.allocator.release(this.candidateValue);
    } catch (error) {
      endpointFailure = error;
    }
    let leaseFailure: unknown;
    try {
      if (this.leaseHeld) await this.options.dataRootLease.release(this.options.dataRoot);
    } catch (error) {
      leaseFailure = error;
    }
    this.runtimeValue = undefined;
    this.candidateValue = undefined;
    this.credentialValue = undefined;
    this.leaseHeld = false;
    this.phaseValue = "stopped";
    const failures = [runtimeFailure, endpointFailure, leaseFailure].filter((error): error is unknown => error !== undefined);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "embedded bootstrap shutdown failed");
  }

  private ready(candidate: LocalEndpointCandidate, credential: string): EmbeddedBootstrapReady {
    return Object.freeze({
      serverId: this.options.serverId,
      serverVersion: this.options.serverVersion,
      endpoint: candidate.endpoint,
      origin: candidate.origin,
      bootstrapCredential: credential,
      credentialDigest: createHash("sha256").update(credential, "utf8").digest("hex"),
    });
  }
}

function validateLoopbackCandidate(candidate: LocalEndpointCandidate): LocalEndpointCandidate {
  if (candidate === null || typeof candidate !== "object" || typeof candidate.origin !== "string" || typeof candidate.endpoint !== "string") {
    throw new TypeError("embedded local endpoint candidate is invalid");
  }
  let origin: URL;
  try {
    origin = new URL(candidate.origin);
  } catch {
    throw new TypeError("embedded local origin must be a loopback URL");
  }
  const hostname = origin.hostname.toLowerCase();
  const isLoopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  if (!isLoopback || (origin.protocol !== "http:" && origin.protocol !== "https:") || origin.username !== "" || origin.password !== "" || origin.pathname !== "/" || origin.search !== "" || origin.hash !== "") {
    throw new TypeError("embedded local origin must be a loopback URL");
  }
  return Object.freeze({ ...candidate, origin: origin.origin });
}

function isBootstrapCredential(value: string): boolean {
  return /^[A-Za-z0-9_-]{32,512}$/u.test(value);
}

export function createEmbeddedBootstrap(options: EmbeddedBootstrapOptions): EmbeddedServerBootstrap {
  return new EmbeddedServerBootstrap(options);
}
