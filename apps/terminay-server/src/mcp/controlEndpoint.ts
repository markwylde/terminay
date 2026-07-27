import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, lstat, mkdir, unlink } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { dirname, isAbsolute } from "node:path";

/**
 * The local control endpoint is deliberately a small server boundary.  It
 * accepts only local stream sockets (Unix domain sockets, or named pipes on
 * Windows), resolves a per-terminal capability on every request, and invokes
 * a server-owned dispatcher.  There is no renderer/PID/process ancestry
 * fallback in this module.
 */

export const CONTROL_PROTOCOL_VERSION = 1 as const;
export const CONTROL_MAX_FRAME_BYTES = 64 * 1024;
export const CONTROL_MAX_RESPONSE_BYTES = 256 * 1024;
export const CONTROL_MAX_IN_FLIGHT_PER_CONNECTION = 8;
export const CONTROL_MAX_IN_FLIGHT_TOTAL = 64;
export const CONTROL_REQUEST_TIMEOUT_MS = 120_000;

export const CONTROL_SOCKET_ENV = "TERMINAY_CONTROL_SOCKET";
export const CONTROL_TOKEN_ENV = "TERMINAY_CONTROL_TOKEN";

export const CONTROL_OPERATIONS = [
  "list_terminals",
  "read_terminal",
  "get_terminal_status",
  "open_terminal",
  "write_terminal",
  "run_command",
  "close_terminal",
  "focus_terminal",
  "rename_terminal",
  "split_terminal",
  "wait_for_idle",
  "wait_for_command",
  "wait_for_attention",
] as const;

export type ControlOperation = (typeof CONTROL_OPERATIONS)[number];
/** Compatibility spelling used by the pre-server control protocol. */
export type ControlOp = ControlOperation;
export type ControlScope = "none" | "read" | "write" | "admin";

export interface ControlRequest {
  readonly id: string;
  readonly token: string;
  readonly version: typeof CONTROL_PROTOCOL_VERSION;
  readonly op: ControlOperation;
  readonly params: Record<string, unknown>;
}

/** Internal dispatch view; the raw capability token is intentionally omitted. */
export type ControlDispatchRequest = Omit<ControlRequest, "token">;

export interface ControlCapabilityScope {
  /** Immutable server-owned terminal identity, never supplied by a request. */
  readonly terminalSessionId: string;
  /** Immutable server-owned project identity, never supplied by a request. */
  readonly projectId: string;
  readonly scope?: ControlScope;
}

export interface ControlCapabilityLease extends ControlCapabilityScope {
  /** The raw token is returned once at mint time and is never stored by the store. */
  readonly token: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface ControlCapabilityStoreOptions {
  readonly now?: () => number;
  readonly ttlMs?: number;
  readonly tokenFactory?: () => string;
  readonly enabled?: boolean;
}

export type CapabilityRevocationListener = (tokenDigest: string) => void;

export interface ControlCapabilityResolver {
  resolve(token: string): ControlCapabilityScope | null | Promise<ControlCapabilityScope | null>;
  onRevoked?(listener: CapabilityRevocationListener): () => void;
  /** Optional lifecycle hook used to revoke every capability on server stop. */
  revokeAll?(): number;
}

export class ControlEndpointError extends Error {
  readonly code: ControlErrorCode;
  readonly candidates: readonly string[] | undefined;

  constructor(code: ControlErrorCode, message: string, candidates?: readonly string[]) {
    super(message);
    this.name = "ControlEndpointError";
    this.code = code;
    this.candidates = candidates;
  }
}

export type ControlErrorCode =
  | "invalid_token"
  | "not_in_terminay"
  | "terminal_not_found"
  | "ambiguous_terminal"
  | "renderer_unavailable"
  | "cancelled"
  | "limit_exceeded"
  | "timeout"
  | "unsupported_op"
  | "bad_request"
  | "forbidden"
  | "not_found"
  | "internal";

export interface ControlError {
  readonly code: ControlErrorCode;
  readonly message: string;
  readonly candidates?: readonly string[];
}

export type ControlResponse =
  | { readonly id: string; readonly ok: true; readonly result: unknown }
  | { readonly id: string; readonly ok: false; readonly error: ControlError };

export interface ControlRequestContext extends ControlCapabilityScope {
  readonly connectionId: string;
  readonly requestId: string;
  readonly signal: AbortSignal;
}

export type ControlDispatchResult =
  | unknown
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly error: ControlError };

export type ControlDispatcher = (
  request: ControlDispatchRequest,
  context: ControlRequestContext,
) => ControlDispatchResult | Promise<ControlDispatchResult>;

/**
 * A server-owned handler for one operation.  The request has already passed
 * the wire-envelope and capability checks performed by the endpoint; the
 * handler still owns operation-specific parameter validation.
 */
export type ControlOperationHandler<TOperation extends ControlOperation = ControlOperation> = (
  request: ControlDispatchRequest & { readonly op: TOperation },
  context: ControlRequestContext,
) => ControlDispatchResult | Promise<ControlDispatchResult>;

/**
 * Operation dispatch is deliberately a table rather than a renderer or PID
 * callback.  Hosts may stage operations independently, so omitted entries are
 * reported as a stable `unsupported_op` result instead of becoming an
 * accidental success or an unbounded fallback.
 */
export type ControlOperationHandlers = Partial<{
  [TOperation in ControlOperation]: ControlOperationHandler<TOperation>;
}>;

export interface ControlEndpointLimits {
  readonly maxFrameBytes: number;
  readonly maxResponseBytes: number;
  readonly maxInFlightPerConnection: number;
  readonly maxInFlightTotal: number;
  readonly requestTimeoutMs: number;
  /** Maximum queued bytes tolerated for a client which is not reading. */
  readonly maxQueuedResponseBytes: number;
}

export interface ControlEndpointOptions extends Partial<ControlEndpointLimits> {
  /** Absolute Unix socket path, or a Windows named-pipe path. */
  readonly socketPath: string;
  readonly capabilities?: ControlCapabilityResolver;
  readonly resolveCapability?: ControlCapabilityResolver["resolve"];
  readonly dispatch: ControlDispatcher;
  /** Override the default authorization floor for an operation. */
  readonly operationScopes?: Partial<Record<ControlOperation, ControlScope>>;
  readonly onError?: (error: unknown) => void;
}

export interface LocalControlEndpoint {
  readonly socketPath: string;
  readonly listening: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export type ControlEndpoint = LocalControlEndpoint;

const INVALID_CAPABILITY_ERROR: ControlError = Object.freeze({
  code: "invalid_token",
  message: "The Terminay terminal capability is missing, invalid, stale, or revoked.",
});

const DEFAULT_OPERATION_SCOPES: Readonly<Partial<Record<ControlOperation, ControlScope>>> = Object.freeze({
  list_terminals: "read",
  read_terminal: "read",
  get_terminal_status: "read",
  wait_for_idle: "read",
  wait_for_command: "read",
  wait_for_attention: "read",
  open_terminal: "write",
  write_terminal: "write",
  run_command: "write",
  close_terminal: "write",
  focus_terminal: "write",
  rename_terminal: "write",
  split_terminal: "write",
});

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const scopeRank: Record<ControlScope, number> = { none: 0, read: 1, write: 2, admin: 3 };
const controlOperations = new Set<string>(CONTROL_OPERATIONS);
const controlErrorCodes = new Set<ControlErrorCode>([
  "invalid_token", "not_in_terminay", "terminal_not_found", "ambiguous_terminal", "renderer_unavailable",
  "cancelled", "limit_exceeded", "timeout", "unsupported_op", "bad_request", "forbidden", "not_found", "internal",
]);
const CONTROL_ERROR_MESSAGE_BYTES = 4 * 1024;
const CONTROL_ERROR_CANDIDATES = 32;
const textDecoder = new TextDecoder("utf-8", { fatal: true });

function assertScopeId(value: string, name: string): void {
  if (!idPattern.test(value)) throw new TypeError(`invalid ${name}`);
}

function isValidToken(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0 || code === 10 || code === 13) return false;
  }
  return true;
}

function assertPositiveLimit(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer`);
}

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

function defaultTokenFactory(): string {
  return `tc_${randomBytes(32).toString("base64url")}`;
}

interface StoredCapability {
  readonly digest: Buffer;
  readonly terminalSessionId: string;
  readonly projectId: string;
  readonly scope: ControlScope;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

/**
 * Server-owned capability storage. Only a SHA-256 digest is retained in
 * memory; the raw token is returned by mint/rotate and is not part of
 * metadata, diagnostics, or persistence APIs.
 */
export class ControlCapabilityStore implements ControlCapabilityResolver {
  private readonly capabilities = new Map<string, StoredCapability>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly tokenFactory: () => string;
  private enabled: boolean;
  private readonly revocationListeners = new Set<CapabilityRevocationListener>();

  constructor(options: ControlCapabilityStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 15 * 60 * 1000;
    this.tokenFactory = options.tokenFactory ?? defaultTokenFactory;
    this.enabled = options.enabled ?? true;
    assertPositiveLimit(this.ttlMs, "ttlMs");
  }

  mint(terminalSessionId: string, projectId: string, scope: ControlScope = "write"): ControlCapabilityLease {
    if (!this.enabled) throw new ControlEndpointError("forbidden", "The local control endpoint is disabled.");
    assertScopeId(terminalSessionId, "terminal session id");
    assertScopeId(projectId, "project id");
    this.assertScope(scope);
    this.revokeSession(terminalSessionId);
    let token = this.tokenFactory();
    if (!isValidToken(token)) throw new TypeError("tokenFactory returned an invalid token");
    let digest = hashToken(token);
    let attempts = 0;
    while (this.hasDigest(digest)) {
      attempts += 1;
      if (attempts >= 32) throw new Error("tokenFactory did not produce a unique capability");
      token = this.tokenFactory();
      if (!isValidToken(token)) throw new TypeError("tokenFactory returned an invalid token");
      digest = hashToken(token);
    }
    const issuedAt = this.now();
    const expiresAt = issuedAt + this.ttlMs;
    this.capabilities.set(digest.toString("hex"), { digest, terminalSessionId, projectId, scope, issuedAt, expiresAt });
    return Object.freeze({ token, terminalSessionId, projectId, scope, issuedAt, expiresAt });
  }

  rotate(terminalSessionId: string, projectId: string, scope: ControlScope = "write"): ControlCapabilityLease {
    return this.mint(terminalSessionId, projectId, scope);
  }

  revoke(token: string): boolean {
    if (!isValidToken(token)) return false;
    const digest = hashToken(token);
    return this.revokeDigest(digest);
  }

  revokeSession(terminalSessionId: string): number {
    let count = 0;
    for (const capability of this.capabilities.values()) {
      if (capability.terminalSessionId === terminalSessionId && this.revokeDigest(capability.digest)) count += 1;
    }
    return count;
  }

  onTerminalExit(terminalSessionId: string): number { return this.revokeSession(terminalSessionId); }

  revokeAll(): number {
    let count = 0;
    for (const capability of [...this.capabilities.values()]) if (this.revokeDigest(capability.digest)) count += 1;
    return count;
  }

  /** Atomically removes a terminal's old project capability and mints a new one. */
  moveTerminal(terminalSessionId: string, projectId: string, scope: ControlScope = "write"): ControlCapabilityLease {
    return this.mint(terminalSessionId, projectId, scope);
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.revokeAll();
    }
  }

  isEnabled(): boolean { return this.enabled; }

  resolve(token: string): ControlCapabilityScope | null {
    if (!this.enabled || !isValidToken(token)) return null;
    const digest = hashToken(token);
    const capability = this.findByDigest(digest);
    if (capability === undefined) return null;
    if (capability.expiresAt <= this.now()) {
      this.revokeDigest(capability.digest);
      return null;
    }
    return { terminalSessionId: capability.terminalSessionId, projectId: capability.projectId, scope: capability.scope };
  }

  authorize(token: string, requiredScope: ControlScope = "read"): ControlCapabilityScope {
    const scope = this.resolve(token);
    if (scope === null) throw new ControlEndpointError("invalid_token", INVALID_CAPABILITY_ERROR.message);
    if (scopeRank[scope.scope ?? "write"] < scopeRank[requiredScope]) throw new ControlEndpointError("forbidden", "The control capability is not permitted for this operation.");
    return scope;
  }

  /** Metadata intentionally excludes raw tokens and token digests. */
  metadata(): readonly Omit<ControlCapabilityLease, "token">[] {
    const result: Omit<ControlCapabilityLease, "token">[] = [];
    for (const capability of this.capabilities.values()) {
      if (capability.expiresAt <= this.now()) {
        this.revokeDigest(capability.digest);
        continue;
      }
      result.push({ terminalSessionId: capability.terminalSessionId, projectId: capability.projectId, scope: capability.scope, issuedAt: capability.issuedAt, expiresAt: capability.expiresAt });
    }
    return result;
  }

  onRevoked(listener: CapabilityRevocationListener): () => void {
    this.revocationListeners.add(listener);
    return () => this.revocationListeners.delete(listener);
  }

  private findByDigest(digest: Buffer): StoredCapability | undefined {
    for (const capability of this.capabilities.values()) {
      if (timingSafeEqual(capability.digest, digest)) return capability;
    }
    return undefined;
  }

  private hasDigest(digest: Buffer): boolean { return this.findByDigest(digest) !== undefined; }

  private revokeDigest(digest: Buffer): boolean {
    const key = digest.toString("hex");
    const removed = this.capabilities.delete(key);
    if (removed) for (const listener of this.revocationListeners) listener(key);
    return removed;
  }

  private assertScope(scope: string): asserts scope is ControlScope {
    if (!(scope in scopeRank)) throw new TypeError("invalid control scope");
  }
}

export class ControlFrameLimitError extends Error {
  constructor(readonly maxBytes: number) { super(`Control frame exceeds the ${maxBytes}-byte limit.`); this.name = "ControlFrameLimitError"; }
}

export class ControlFrameMalformedError extends Error {
  constructor(message = "Malformed control frame.") { super(message); this.name = "ControlFrameMalformedError"; }
}

/** Incremental UTF-8 JSONL decoder with a hard limit for partial frames. */
export class ControlFrameDecoder {
  private buffered = new Uint8Array();
  constructor(readonly maxFrameBytes = CONTROL_MAX_FRAME_BYTES, private readonly maxFramesPerPush = 128) {
    assertPositiveLimit(maxFrameBytes, "maxFrameBytes");
    assertPositiveLimit(maxFramesPerPush, "maxFramesPerPush");
  }

  push(chunk: Uint8Array): unknown[] {
    if (!(chunk instanceof Uint8Array)) throw new TypeError("control frame chunks must be Uint8Array");
    if (chunk.byteLength === 0) return [];
    // Refuse an unbounded read before copying it into the accumulator. A
    // chunk containing complete frames is allowed only up to the bounded
    // batch ceiling; a partial frame can never exceed maxFrameBytes.
    if (chunk.byteLength > this.maxFrameBytes * this.maxFramesPerPush ||
      (this.buffered.byteLength + chunk.byteLength > this.maxFrameBytes && !chunk.includes(0x0a))) {
      throw new ControlFrameLimitError(this.maxFrameBytes);
    }
    const next = new Uint8Array(this.buffered.byteLength + chunk.byteLength);
    next.set(this.buffered); next.set(chunk, this.buffered.byteLength); this.buffered = next;
    const values: unknown[] = [];
    let offset = 0;
    for (let index = 0; index < this.buffered.byteLength; index += 1) {
      if (this.buffered[index] !== 0x0a) continue;
      const line = this.buffered.subarray(offset, index);
      if (line.byteLength > this.maxFrameBytes) throw new ControlFrameLimitError(this.maxFrameBytes);
      if (line.byteLength === 0) throw new ControlFrameMalformedError("Empty control frame.");
      const withoutCarriage = line[line.byteLength - 1] === 0x0d ? line.subarray(0, line.byteLength - 1) : line;
      let parsed: unknown;
      try { parsed = JSON.parse(textDecoder.decode(withoutCarriage)); } catch { throw new ControlFrameMalformedError(); }
      values.push(parsed); offset = index + 1;
      if (values.length > this.maxFramesPerPush) throw new ControlFrameMalformedError("Too many control frames in one read.");
    }
    this.buffered = this.buffered.slice(offset);
    if (this.buffered.byteLength > this.maxFrameBytes) throw new ControlFrameLimitError(this.maxFrameBytes);
    return values;
  }

  finish(): void { if (this.buffered.byteLength !== 0) throw new ControlFrameMalformedError("Truncated control frame."); }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isControlRequest(value: unknown): value is ControlRequest {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.join("|") !== "id|op|params|token|version") return false;
  return typeof value.id === "string" && idPattern.test(value.id) &&
    isValidToken(value.token) &&
    value.version === CONTROL_PROTOCOL_VERSION && typeof value.op === "string" && controlOperations.has(value.op) &&
    isPlainObject(value.params);
}

export function encodeControlMessage(message: unknown): string {
  const encoded = JSON.stringify(message);
  if (encoded === undefined) throw new TypeError("control message is not JSON serializable");
  return `${encoded}\n`;
}

function responseForError(id: string, error: ControlError): ControlResponse { return { id, ok: false, error }; }
function candidateId(value: unknown): string | null {
  return isPlainObject(value) && typeof value.id === "string" && idPattern.test(value.id) ? value.id : null;
}

function normalizeScope(value: ControlCapabilityScope | null): ControlCapabilityScope | null {
  if (value === null || !isPlainObject(value)) return null;
  if (typeof value.terminalSessionId !== "string" || typeof value.projectId !== "string") return null;
  if (!idPattern.test(value.terminalSessionId) || !idPattern.test(value.projectId)) return null;
  if (value.scope !== undefined && !(value.scope in scopeRank)) return null;
  return { terminalSessionId: value.terminalSessionId, projectId: value.projectId, scope: value.scope ?? "write" };
}

function asControlError(error: unknown): ControlError {
  if (isPlainObject(error) && typeof error.code === "string" && controlErrorCodes.has(error.code as ControlErrorCode) && typeof error.message === "string") {
    const message = error.message.slice(0, CONTROL_ERROR_MESSAGE_BYTES);
    const candidates = Array.isArray(error.candidates)
      ? error.candidates.filter((candidate): candidate is string => typeof candidate === "string" && idPattern.test(candidate)).slice(0, CONTROL_ERROR_CANDIDATES)
      : undefined;
    return { code: error.code as ControlErrorCode, message, ...(candidates === undefined || candidates.length === 0 ? {} : { candidates }) };
  }
  if (error instanceof ControlEndpointError) {
    const candidates = error.candidates?.filter((candidate): candidate is string => typeof candidate === "string" && idPattern.test(candidate)).slice(0, CONTROL_ERROR_CANDIDATES);
    return { code: error.code, message: error.message.slice(0, CONTROL_ERROR_MESSAGE_BYTES), ...(candidates === undefined || candidates.length === 0 ? {} : { candidates }) };
  }
  return { code: "internal", message: "The control operation failed." };
}

/**
 * Build the server-side operation dispatcher used by a local control
 * endpoint.  Each request is routed by its validated operation name; there is
 * no renderer, window, PID, or request-body scope fallback in this path.
 *
 * Handlers may return either a plain result or an explicit result/error
 * envelope.  A typed ControlEndpointError is converted to its stable public
 * error shape, while an unexpected exception is intentionally collapsed to a
 * generic internal error so implementation details cannot cross the socket.
 */
export function createControlOperationDispatcher(handlers: ControlOperationHandlers): ControlDispatcher {
  if (!isPlainObject(handlers)) throw new TypeError("control operation handlers must be an object");
  for (const [operation, handler] of Object.entries(handlers)) {
    if (!controlOperations.has(operation)) throw new TypeError(`unsupported control operation handler: ${operation}`);
    if (handler !== undefined && typeof handler !== "function") throw new TypeError(`control operation handler must be a function: ${operation}`);
  }
  const table = Object.freeze({ ...handlers }) as ControlOperationHandlers;
  return async (request, context) => {
    const handler = table[request.op] as ControlOperationHandler | undefined;
    if (handler === undefined) {
      return {
        ok: false,
        error: { code: "unsupported_op", message: `The control operation is not available: ${request.op}.` },
      } satisfies ControlDispatchResult;
    }
    try {
      return await handler(request, context);
    } catch (error) {
      return { ok: false, error: asControlError(error) } satisfies ControlDispatchResult;
    }
  };
}

function localSocketPath(socketPath: string): boolean {
  const namedPipe = socketPath.startsWith("\\\\.\\pipe\\");
  if (namedPipe) return true;
  if (!isAbsolute(socketPath)) throw new TypeError("control socket path must be absolute");
  if (/^(?:tcp|udp|http|https):\/\//i.test(socketPath)) throw new TypeError("control endpoint must be local");
  return true;
}

async function removeStaleSocket(socketPath: string): Promise<void> {
  try {
    const stat = await lstat(socketPath);
    if (!stat.isSocket()) throw new Error("control endpoint path exists and is not a socket");
    await unlink(socketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function createControlEndpoint(options: ControlEndpointOptions): LocalControlEndpoint {
  localSocketPath(options.socketPath);
  const resolveCapability = options.resolveCapability ?? options.capabilities?.resolve.bind(options.capabilities);
  if (resolveCapability === undefined) throw new TypeError("a capability resolver is required");
  const resolve = resolveCapability;
  const maxFrameBytes = options.maxFrameBytes ?? CONTROL_MAX_FRAME_BYTES;
  const maxResponseBytes = options.maxResponseBytes ?? CONTROL_MAX_RESPONSE_BYTES;
  const maxInFlightPerConnection = options.maxInFlightPerConnection ?? CONTROL_MAX_IN_FLIGHT_PER_CONNECTION;
  const maxInFlightTotal = options.maxInFlightTotal ?? CONTROL_MAX_IN_FLIGHT_TOTAL;
  const requestTimeoutMs = options.requestTimeoutMs ?? CONTROL_REQUEST_TIMEOUT_MS;
  const maxQueuedResponseBytes = options.maxQueuedResponseBytes ?? maxResponseBytes * 2;
  assertPositiveLimit(maxFrameBytes, "maxFrameBytes"); assertPositiveLimit(maxResponseBytes, "maxResponseBytes");
  assertPositiveLimit(maxInFlightPerConnection, "maxInFlightPerConnection"); assertPositiveLimit(maxInFlightTotal, "maxInFlightTotal");
  assertPositiveLimit(requestTimeoutMs, "requestTimeoutMs"); assertPositiveLimit(maxQueuedResponseBytes, "maxQueuedResponseBytes");
  const operationScopes = { ...DEFAULT_OPERATION_SCOPES, ...options.operationScopes };
  let server: Server | undefined;
  let listening = false;
  let nextConnectionId = 0;
  let totalInFlight = 0;
  const connections = new Set<Socket>();
  const allControllers = new Map<AbortController, string>();
  let removeRevocationListener: (() => void) | undefined;

  const reportError = (error: unknown): void => { options.onError?.(error); };

  function writeResponse(socket: Socket, response: ControlResponse): void {
    if (!socket.writable || socket.destroyed) return;
    let encoded: string;
    try { encoded = encodeControlMessage(response); } catch { encoded = encodeControlMessage(responseForError(response.id, { code: "internal", message: "The control response was not serializable." })); }
    if (Buffer.byteLength(encoded, "utf8") > maxResponseBytes) {
      encoded = encodeControlMessage(responseForError(response.id, { code: "limit_exceeded", message: "The control response exceeded its size limit." }));
    }
    if (socket.writableLength + Buffer.byteLength(encoded, "utf8") > maxQueuedResponseBytes) {
      socket.destroy(new Error("control client is not reading bounded responses"));
      return;
    }
    socket.write(encoded);
  }

  function abortForRevokedDigest(digest: string): void {
    for (const [controller, tokenDigest] of allControllers) if (tokenDigest === digest) controller.abort("revoked");
  }

  async function handleRequest(socket: Socket, connectionId: string, inFlight: Map<string, AbortController>, value: unknown): Promise<void> {
    const id = candidateId(value);
    if (!isControlRequest(value)) {
      if (id !== null) writeResponse(socket, responseForError(id, { code: "bad_request", message: "Malformed control request envelope." }));
      else socket.destroy(new Error("malformed control request"));
      return;
    }
    const request = value;
    if (inFlight.has(request.id)) { writeResponse(socket, responseForError(request.id, { code: "bad_request", message: "A request with this id is already in flight." })); return; }
    if (inFlight.size >= maxInFlightPerConnection) { writeResponse(socket, responseForError(request.id, { code: "limit_exceeded", message: "The per-connection control concurrency limit was exceeded." })); return; }
    if (totalInFlight >= maxInFlightTotal) { writeResponse(socket, responseForError(request.id, { code: "limit_exceeded", message: "The control concurrency limit was exceeded." })); return; }
    const controller = new AbortController();
    inFlight.set(request.id, controller); allControllers.set(controller, hashToken(request.token).toString("hex")); totalInFlight += 1;
    const timeout = setTimeout(() => controller.abort("timeout"), requestTimeoutMs);
    const aborted = new Promise<ControlResponse>((resolve) => controller.signal.addEventListener("abort", () => {
      if (!socket.writable || controller.signal.reason === "caller_closed") return;
      const code: ControlErrorCode = controller.signal.reason === "timeout" ? "timeout" : controller.signal.reason === "revoked" ? "invalid_token" : "cancelled";
      resolve(responseForError(request.id, code === "timeout" ? { code, message: "The control request exceeded its deadline." } : code === "invalid_token" ? INVALID_CAPABILITY_ERROR : { code, message: "The control request was cancelled." }));
    }, { once: true }));
    try {
      const operation = Promise.resolve().then(async () => {
        let resolvedScope: ControlCapabilityScope | null;
        try { resolvedScope = await resolve(request.token); } catch { return responseForError(request.id, INVALID_CAPABILITY_ERROR); }
        const scope = normalizeScope(resolvedScope);
        if (scope === null) return responseForError(request.id, INVALID_CAPABILITY_ERROR);
        const requiredScope = operationScopes[request.op] ?? "read";
        if (scopeRank[scope.scope ?? "write"] < scopeRank[requiredScope]) return responseForError(request.id, { code: "forbidden", message: "The control capability is not permitted for this operation." });
        if (controller.signal.aborted) return undefined;
        const { token: _token, ...dispatchRequest } = request;
        const dispatchResult = await options.dispatch(dispatchRequest, { ...scope, connectionId, requestId: request.id, signal: controller.signal });
        if (isPlainObject(dispatchResult) && dispatchResult.ok === false && "error" in dispatchResult) return responseForError(request.id, asControlError(dispatchResult.error));
        if (isPlainObject(dispatchResult) && dispatchResult.ok === true && "result" in dispatchResult) return { id: request.id, ok: true, result: dispatchResult.result } satisfies ControlResponse;
        return { id: request.id, ok: true, result: dispatchResult === undefined ? null : dispatchResult } satisfies ControlResponse;
      });
      const result = await Promise.race([operation, aborted]);
      if (result !== undefined && socket.writable && controller.signal.reason !== "caller_closed") writeResponse(socket, result);
    } catch (error) {
      reportError(error);
      if (socket.writable && controller.signal.reason !== "caller_closed") writeResponse(socket, responseForError(request.id, asControlError(error)));
    } finally {
      clearTimeout(timeout); inFlight.delete(request.id); allControllers.delete(controller); totalInFlight -= 1;
    }
  }

  function onConnection(socket: Socket): void {
    const connectionId = `connection-${++nextConnectionId}`;
    const inFlight = new Map<string, AbortController>();
    const decoder = new ControlFrameDecoder(maxFrameBytes);
    connections.add(socket);
    socket.on("data", (chunk: Buffer) => {
      let values: unknown[];
      try { values = decoder.push(chunk); } catch (error) { reportError(error); socket.destroy(error instanceof Error ? error : undefined); return; }
      for (const value of values) void handleRequest(socket, connectionId, inFlight, value).catch(reportError);
    });
    socket.on("error", reportError);
    socket.on("close", () => {
      for (const controller of inFlight.values()) controller.abort("caller_closed");
      inFlight.clear(); connections.delete(socket);
    });
  }

  async function start(): Promise<void> {
    if (listening) return;
    if (!options.socketPath.startsWith("\\\\.\\pipe\\")) {
      const parent = dirname(options.socketPath);
      await mkdir(parent, { recursive: true, mode: 0o700 });
      // Never change permissions on a filesystem root. Applications should
      // normally provide a private data directory, which is tightened here.
      if (parent !== "/" && parent !== ".") await chmod(parent, 0o700);
      await removeStaleSocket(options.socketPath);
    }
    const nextServer = createServer(onConnection);
    await new Promise<void>((resolve, reject) => {
      const onListening = (): void => { nextServer.off("error", onError); resolve(); };
      const onError = (error: Error): void => { nextServer.off("listening", onListening); reject(error); };
      nextServer.once("listening", onListening); nextServer.once("error", onError); nextServer.on("error", reportError); nextServer.listen(options.socketPath);
    });
    if (!options.socketPath.startsWith("\\\\.\\pipe\\")) await chmod(options.socketPath, 0o600);
    server = nextServer; listening = true;
    if (options.capabilities?.onRevoked !== undefined) removeRevocationListener = options.capabilities.onRevoked(abortForRevokedDigest);
  }

  async function stop(): Promise<void> {
    if (!listening || server === undefined) return;
    const closing = server; server = undefined; listening = false;
    removeRevocationListener?.(); removeRevocationListener = undefined;
    for (const controller of allControllers.keys()) controller.abort("caller_closed");
    options.capabilities?.revokeAll?.();
    for (const socket of connections) socket.destroy();
    await new Promise<void>((resolve) => closing.close(() => resolve()));
    if (!options.socketPath.startsWith("\\\\.\\pipe\\")) await removeStaleSocket(options.socketPath);
  }

  return { socketPath: options.socketPath, get listening() { return listening; }, start, stop };
}

export const createLocalControlEndpoint = createControlEndpoint;
export const createMcpControlEndpoint = createControlEndpoint;
