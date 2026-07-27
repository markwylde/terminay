import { TerminalServiceError } from "./errors.js";
import type {
  TerminalAuthorization,
  TerminalIdentity,
} from "./types.js";
import type { TerminalService } from "./service.js";

/** Every user- or automation-originated write crosses this one boundary. */
export type TerminalInputSource = "keyboard" | "paste" | "macro" | "dictation" | "mcp" | "remote";
export type TerminalResizeMode = "claim" | "update" | "release";
export type TerminalViewport = "wide" | "narrow" | "mobile";

export interface TerminalInputSourceRequest {
  readonly identity: TerminalIdentity;
  readonly clientId: string;
  readonly source: TerminalInputSource;
  readonly data: Uint8Array | string;
  readonly authorization?: TerminalAuthorization;
  /** Optional per-source monotonic sequence used by reconnecting clients. */
  readonly sequence?: number;
}

export interface TerminalInputSourceResult {
  readonly serverId: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly clientId: string;
  readonly source: TerminalInputSource;
  readonly bytes: number;
  readonly sequence?: number;
  readonly queuedBytes: number;
}

export interface TerminalResizeRequest {
  readonly identity: TerminalIdentity;
  readonly clientId: string;
  readonly source: TerminalInputSource;
  readonly viewport: TerminalViewport;
  readonly mode: TerminalResizeMode;
  readonly cols?: number;
  readonly rows?: number;
  readonly leaseMs?: number;
  readonly authorization?: TerminalAuthorization;
}

export interface TerminalResizeOwnership {
  readonly clientId: string;
  readonly source: TerminalInputSource;
  readonly viewport: TerminalViewport;
  readonly cols: number;
  readonly rows: number;
  readonly leaseExpiresAt: number;
  readonly revision: number;
}

export interface TerminalResizeResult {
  readonly mode: TerminalResizeMode;
  readonly ownership?: TerminalResizeOwnership;
}

export interface TerminalInputSourceAdapterOptions {
  /** Aggregate bytes retained while a PTY write is in flight. */
  readonly maxQueuedInputBytes?: number;
  /** Default lease used when a client claims terminal dimensions. */
  readonly resizeLeaseMs?: number;
  readonly maxResizeLeaseMs?: number;
  readonly now?: () => number;
}

interface QueuedWrite {
  readonly identity: TerminalIdentity;
  readonly authorization: TerminalAuthorization | undefined;
  readonly clientId: string;
  readonly source: TerminalInputSource;
  readonly bytes: Uint8Array;
  readonly sequence: number | undefined;
  readonly resolve: (result: TerminalInputSourceResult) => void;
  readonly reject: (error: unknown) => void;
}

interface InputQueue {
  readonly key: string;
  readonly items: QueuedWrite[];
  pendingBytes: number;
  active: boolean;
}

interface MutableResizeOwnership {
  clientId: string;
  source: TerminalInputSource;
  viewport: TerminalViewport;
  cols: number;
  rows: number;
  leaseExpiresAt: number;
  revision: number;
}

const SOURCES: readonly TerminalInputSource[] = ["keyboard", "paste", "macro", "dictation", "mcp", "remote"];
const VIEWPORTS: readonly TerminalViewport[] = ["wide", "narrow", "mobile"];
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DEFAULT_MAX_QUEUED_INPUT_BYTES = 256 * 1024;
const DEFAULT_RESIZE_LEASE_MS = 10_000;
const DEFAULT_MAX_RESIZE_LEASE_MS = 60_000;

/**
 * Server-owned boundary for every terminal writer and viewport participant.
 * It serializes writes per exact session, bounds pending bytes, and keeps
 * resize ownership independent from PTY lifetime or Electron window ids.
 */
export class TerminalInputSourceAdapter {
  private readonly service: TerminalService;
  private readonly maxQueuedInputBytes: number;
  private readonly resizeLeaseMs: number;
  private readonly maxResizeLeaseMs: number;
  private readonly now: () => number;
  private readonly queues = new Map<string, InputQueue>();
  private readonly lastSequences = new Map<string, number>();
  private readonly resizeOwners = new Map<string, MutableResizeOwnership>();

  constructor(service: TerminalService, options: TerminalInputSourceAdapterOptions = {}) {
    this.service = service;
    this.maxQueuedInputBytes = positiveLimit(options.maxQueuedInputBytes ?? DEFAULT_MAX_QUEUED_INPUT_BYTES, "maxQueuedInputBytes");
    this.maxResizeLeaseMs = positiveLimit(options.maxResizeLeaseMs ?? DEFAULT_MAX_RESIZE_LEASE_MS, "maxResizeLeaseMs");
    this.resizeLeaseMs = boundedLease(options.resizeLeaseMs ?? DEFAULT_RESIZE_LEASE_MS, this.maxResizeLeaseMs);
    this.now = options.now ?? (() => Date.now());
  }

  /** Alias used by protocol adapters that call terminal writes `input`. */
  input(request: TerminalInputSourceRequest): Promise<TerminalInputSourceResult> {
    return this.write(request);
  }

  write(request: TerminalInputSourceRequest): Promise<TerminalInputSourceResult> {
    const normalized = normalizeInputRequest(request);
    this.assertWritable(normalized.identity, normalized.authorization, normalized.clientId);
    const bytes = toBytes(normalized.data);
    const key = sessionKey(normalized.identity);
    const queue = this.queues.get(key) ?? this.createQueue(key);
    if (queue.pendingBytes + bytes.byteLength > this.maxQueuedInputBytes) {
      throw new TerminalServiceError("queue_overflow", "terminal input queue is full", { max: this.maxQueuedInputBytes, actual: queue.pendingBytes + bytes.byteLength });
    }
    if (normalized.sequence !== undefined) {
      const sequenceKey = `${key}\u0000${normalized.clientId}\u0000${normalized.source}`;
      const previous = this.lastSequences.get(sequenceKey);
      if (previous !== undefined && normalized.sequence <= previous) throw new TerminalServiceError("invalid_position", "terminal input sequence is stale", { expected: previous + 1, actual: normalized.sequence });
      this.lastSequences.set(sequenceKey, normalized.sequence);
    }
    return new Promise<TerminalInputSourceResult>((resolve, reject) => {
      queue.pendingBytes += bytes.byteLength;
      queue.items.push({
        identity: normalized.identity,
        authorization: normalized.authorization,
        clientId: normalized.clientId,
        source: normalized.source,
        bytes,
        sequence: normalized.sequence,
        resolve,
        reject,
      });
      void this.pump(queue);
    });
  }

  async resize(request: TerminalResizeRequest): Promise<TerminalResizeResult> {
    const normalized = normalizeResizeRequest(request);
    const key = sessionKey(normalized.identity);
    this.assertWritable(normalized.identity, normalized.authorization, normalized.clientId);
    const now = this.now();
    let owner = this.resizeOwners.get(key);
    if (owner !== undefined && owner.leaseExpiresAt <= now) {
      this.resizeOwners.delete(key);
      owner = undefined;
    }

    if (normalized.mode === "release") {
      if (owner === undefined) return Object.freeze({ mode: "release" });
      if (owner.clientId !== normalized.clientId) throw resizeOwnershipError(owner);
      this.resizeOwners.delete(key);
      return Object.freeze({ mode: "release" });
    }

    if (normalized.mode === "update" && (owner === undefined || owner.clientId !== normalized.clientId)) {
      throw owner === undefined ? new TerminalServiceError("forbidden", "terminal resize ownership has expired", { reason: "resize_owner" }) : resizeOwnershipError(owner);
    }
    if (normalized.mode === "claim" && owner !== undefined && owner.clientId !== normalized.clientId) throw resizeOwnershipError(owner);

    const dimensions = { cols: normalized.cols as number, rows: normalized.rows as number };
    await this.service.resize(normalized.identity, dimensions, normalized.authorization);
    const snapshot = this.service.getSession(normalized.identity);
    if (snapshot === undefined) throw new TerminalServiceError("session_not_found", "terminal session not found", { sessionId: normalized.identity.sessionId });
    const leaseExpiresAt = now + boundedLease(normalized.leaseMs ?? this.resizeLeaseMs, this.maxResizeLeaseMs);
    const next: MutableResizeOwnership = {
      clientId: normalized.clientId,
      source: normalized.source,
      viewport: normalized.viewport,
      cols: snapshot.dimensions.cols,
      rows: snapshot.dimensions.rows,
      leaseExpiresAt,
      revision: (owner?.revision ?? 0) + 1,
    };
    this.resizeOwners.set(key, next);
    return Object.freeze({ mode: normalized.mode, ownership: freezeOwnership(next) });
  }

  /** Release a disconnected/stale client without terminating its PTY. */
  releaseClient(identity: TerminalIdentity, clientId: string): boolean {
    validateClientId(clientId);
    const key = sessionKey(identity);
    const owner = this.resizeOwners.get(key);
    if (owner?.clientId !== clientId) return false;
    this.resizeOwners.delete(key);
    return true;
  }

  getResizeOwnership(identity: TerminalIdentity): TerminalResizeOwnership | undefined {
    const key = sessionKey(identity);
    const owner = this.resizeOwners.get(key);
    if (owner === undefined) return undefined;
    if (owner.leaseExpiresAt <= this.now()) {
      this.resizeOwners.delete(key);
      return undefined;
    }
    return freezeOwnership(owner);
  }

  private createQueue(key: string): InputQueue {
    const queue: InputQueue = { key, items: [], pendingBytes: 0, active: false };
    this.queues.set(key, queue);
    return queue;
  }

  private async pump(queue: InputQueue): Promise<void> {
    if (queue.active) return;
    queue.active = true;
    try {
      while (queue.items.length > 0) {
        const item = queue.items.shift();
        if (item === undefined) break;
        try {
          await this.service.input(item.identity, item.bytes, item.authorization);
          item.resolve(Object.freeze({
            ...item.identity,
            clientId: item.clientId,
            source: item.source,
            bytes: item.bytes.byteLength,
            ...(item.sequence === undefined ? {} : { sequence: item.sequence }),
            queuedBytes: queue.pendingBytes - item.bytes.byteLength,
          }));
        } catch (error) {
          item.reject(error);
        } finally {
          queue.pendingBytes -= item.bytes.byteLength;
        }
      }
    } finally {
      queue.active = false;
      if (queue.items.length === 0 && queue.pendingBytes === 0) this.queues.delete(queue.key);
    }
  }

  private assertWritable(identity: TerminalIdentity, authorization: TerminalAuthorization | undefined, clientId: string): void {
    validateIdentity(identity);
    const snapshot = this.service.getSession(identity);
    if (snapshot === undefined) throw new TerminalServiceError("session_not_found", "terminal session not found", { sessionId: identity.sessionId });
    if (snapshot.serverId !== identity.serverId || snapshot.projectId !== identity.projectId || snapshot.sessionId !== identity.sessionId) throw new TerminalServiceError("forbidden", "terminal identity is outside its source boundary", { reason: "identity" });
    if (snapshot.status === "exited") throw new TerminalServiceError("session_exited", "terminal session has exited", { sessionId: identity.sessionId });
    if (snapshot.status === "interrupted") throw new TerminalServiceError("session_interrupted", "terminal session was interrupted", { sessionId: identity.sessionId });
    if (authorization !== undefined) {
      if (authorization.serverId !== identity.serverId || authorization.projectId !== identity.projectId || (authorization.sessionId !== undefined && authorization.sessionId !== identity.sessionId) || (authorization.clientId !== undefined && authorization.clientId !== clientId)) throw new TerminalServiceError("forbidden", "terminal authorization is outside its source boundary", { reason: "authorization" });
      if (authorization.scope !== "write" && authorization.scope !== "admin") throw new TerminalServiceError("forbidden", "terminal source is not authorized to write", { reason: "write" });
    }
  }
}

function normalizeInputRequest(request: TerminalInputSourceRequest): TerminalInputSourceRequest {
  validateIdentity(request.identity);
  validateClientId(request.clientId);
  validateSource(request.source);
  if (request.authorization?.clientId !== undefined && request.authorization.clientId !== request.clientId) throw new TerminalServiceError("forbidden", "terminal authorization client does not match input source", { reason: "client" });
  if (request.sequence !== undefined && (!Number.isSafeInteger(request.sequence) || request.sequence < 0)) throw new TerminalServiceError("invalid_position", "terminal input sequence is invalid");
  return request;
}

function normalizeResizeRequest(request: TerminalResizeRequest): TerminalResizeRequest {
  validateIdentity(request.identity);
  validateClientId(request.clientId);
  validateSource(request.source);
  if (!VIEWPORTS.includes(request.viewport)) throw new TerminalServiceError("invalid_identity", "terminal viewport is invalid");
  if (request.mode !== "claim" && request.mode !== "update" && request.mode !== "release") throw new TerminalServiceError("invalid_identity", "terminal resize mode is invalid");
  if (request.mode !== "release" && (!Number.isSafeInteger(request.cols) || !Number.isSafeInteger(request.rows))) throw new TerminalServiceError("invalid_dimensions", "terminal resize dimensions are invalid");
  if (request.mode === "release" && (request.cols !== undefined || request.rows !== undefined)) throw new TerminalServiceError("invalid_dimensions", "terminal release cannot carry dimensions");
  return request;
}

function validateIdentity(identity: TerminalIdentity): void {
  for (const name of Object.keys(identity)) if (name !== "serverId" && name !== "projectId" && name !== "sessionId") throw new TerminalServiceError("invalid_identity", "terminal identity contains unknown fields");
  for (const value of [identity.serverId, identity.projectId, identity.sessionId]) if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new TerminalServiceError("invalid_identity", "terminal identity is invalid");
}

function validateClientId(value: string): void {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new TerminalServiceError("invalid_identity", "terminal client id is invalid");
}

function validateSource(value: TerminalInputSource): void {
  if (!SOURCES.includes(value)) throw new TerminalServiceError("invalid_identity", "terminal input source is invalid");
}

function toBytes(value: Uint8Array | string): Uint8Array {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new TerminalServiceError("invalid_bytes", "terminal input bytes are invalid");
  return bytes.slice();
}

function sessionKey(identity: TerminalIdentity): string {
  return `${identity.serverId}\u0000${identity.projectId}\u0000${identity.sessionId}`;
}

function resizeOwnershipError(owner: MutableResizeOwnership): TerminalServiceError {
  return new TerminalServiceError("forbidden", "terminal resize is owned by another client", { reason: "resize_owner", actual: owner.clientId });
}

function freezeOwnership(value: MutableResizeOwnership): TerminalResizeOwnership {
  return Object.freeze({ ...value });
}

function positiveLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`);
  return value;
}

function boundedLease(value: number, max: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) throw new RangeError("resize lease is out of bounds");
  return value;
}
