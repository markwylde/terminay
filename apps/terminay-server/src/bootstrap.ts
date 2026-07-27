import { createHash, randomBytes } from "node:crypto";
import type { ServerRuntime, ServerRuntimeConfig, ServerRuntimeHooks } from "@terminay/server-core";
import { createEmbeddedServer } from "./index.js";

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
  readonly hooks?: ServerRuntimeHooks;
  readonly publishReady?: (ready: EmbeddedBootstrapReady) => Promise<void> | void;
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

  constructor(private readonly options: EmbeddedBootstrapOptions) {
    if (!options.dataRoot || options.dataRoot.length > 4096) throw new TypeError("dataRoot is invalid");
  }

  get phase(): EmbeddedBootstrapPhase { return this.phaseValue; }
  get runtime(): ServerRuntime | undefined { return this.runtimeValue; }

  async start(): Promise<EmbeddedBootstrapReady> {
    if (this.phaseValue === "ready" && this.runtimeValue !== undefined && this.candidateValue !== undefined && this.credentialValue !== undefined) {
      return this.ready(this.candidateValue, this.credentialValue);
    }
    // A deliberate stop releases the endpoint/data-root lease. Recovery is an
    // explicit new authority claim, never an implicit second runtime.
    if (this.phaseValue === "stopped" || this.phaseValue === "failed") this.phaseValue = "created";
    if (this.phaseValue !== "created") throw new Error(`embedded bootstrap is ${this.phaseValue}`);
    this.phaseValue = "starting";
    let candidate: LocalEndpointCandidate | undefined;
    try {
      await this.options.dataRootLease.acquire(this.options.dataRoot);
      this.leaseHeld = true;
      candidate = await this.options.allocator.choose();
      await this.options.allocator.claim(candidate);
      this.candidateValue = candidate;
      const credential = randomBytes(32).toString("base64url");
      this.credentialValue = credential;
      const { allocator: _allocator, dataRootLease: _dataRootLease, publishReady: _publishReady, hooks, ...config } = this.options;
      void _allocator;
      void _dataRootLease;
      void _publishReady;
      const runtime = createEmbeddedServer({
        ...config,
        localEndpoint: candidate.endpoint,
        ...(hooks === undefined ? {} : { hooks }),
      });
      this.runtimeValue = runtime;
      await runtime.start();
      this.phaseValue = "ready";
      const ready = this.ready(candidate, credential);
      await this.options.publishReady?.(ready);
      return ready;
    } catch (error) {
      this.phaseValue = "failed";
      if (candidate !== undefined) await Promise.resolve(this.options.allocator.release(candidate)).catch(() => undefined);
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
    if (this.runtimeValue !== undefined) await this.runtimeValue.stop();
    if (this.candidateValue !== undefined) await this.options.allocator.release(this.candidateValue);
    if (this.leaseHeld) await this.options.dataRootLease.release(this.options.dataRoot);
    this.runtimeValue = undefined;
    this.candidateValue = undefined;
    this.credentialValue = undefined;
    this.leaseHeld = false;
    this.phaseValue = "stopped";
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

export function createEmbeddedBootstrap(options: EmbeddedBootstrapOptions): EmbeddedServerBootstrap {
  return new EmbeddedServerBootstrap(options);
}
