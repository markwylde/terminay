import {
  decodeFrame,
  encodeFrame,
  negotiateVersion,
  type ByteTransport,
  type ClientHello,
  type CommandResultEnvelope,
  type Envelope,
  type JsonValue,
  type ProtocolLimits,
  type QueryResultEnvelope,
  type ServerHello,
} from "@terminay/protocol";
import {
  ClientDisconnectedError,
  ClientError,
  CommandOutcomeUnknownError,
  type ClientCommandResult,
  type ClientEvent,
  type ClientQueryResult,
  type ClientSubscription,
  type CommandOptions,
  type ConnectionSnapshot,
  type ConnectionState,
  type ConnectionStateChange,
  type QueryOptions,
  type ReconnectOptions,
  type ResyncOptions,
  type ResyncResult,
  type SubscriptionOptions,
  type TerminayClientOptions,
} from "./types.js";

type Pending<T> = { readonly resolve: (value: T) => void; readonly reject: (error: unknown) => void };

const DEFAULT_LIMITS: ProtocolLimits = {
  maxFrameBytes: 8 * 1024 * 1024,
  maxHeaderBytes: 64 * 1024,
  maxBodyBytes: 8 * 1024 * 1024 - 64 * 1024,
  maxQueuedBytes: 16 * 1024 * 1024,
  maxStreamChunkBytes: 256 * 1024,
  maxBinaryChunkBytes: 1024 * 1024,
  maxCapabilities: 256,
  maxEventsPerBatch: 256,
};

function id(prefix: string): string {
  const random = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`.slice(0, 128);
}

function abortError(signal?: AbortSignal): Error | undefined {
  if (!signal?.aborted) return undefined;
  return signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted", "AbortError");
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  const error = abortError(signal);
  if (error !== undefined) return Promise.reject(error);
  if (signal === undefined) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then((value) => { signal.removeEventListener("abort", onAbort); resolve(value); }, (reason) => { signal.removeEventListener("abort", onAbort); reject(reason); });
  });
}

function resultError(result: { readonly ok: boolean; readonly error?: { readonly code: ClientError["code"]; readonly message: string; readonly details?: JsonValue; readonly retryable?: boolean } }): ClientError | undefined {
  if (result.ok || result.error === undefined) return undefined;
  return new ClientError(result.error.code, result.error.message, {
    ...(result.error.details === undefined ? {} : { details: result.error.details }),
    ...(result.error.retryable === undefined ? {} : { retryable: result.error.retryable }),
  });
}

/** Transport-neutral application client. Hosts provide only a ByteTransport. */
export class TerminayClient {
  private readonly transport: ByteTransport;
  private readonly options: TerminayClientOptions;
  private readonly listeners = new Set<(change: ConnectionStateChange) => void>();
  private readonly events = new Map<string, Set<(event: ClientEvent) => void>>();
  private readonly pending = new Map<string, Pending<QueryResultEnvelope | CommandResultEnvelope>>();
  private current: ConnectionSnapshot = { state: "idle", revision: 0, cursor: "0", stale: false, reconnectAttempt: 0 };
  private readerStarted = false;
  private handshake: (Pending<ServerHello> & { readonly promise: Promise<ServerHello> }) | undefined;
  private closed = false;
  private commandCounter = 0;

  constructor(options: TerminayClientOptions) {
    this.transport = options.transport;
    this.options = options;
  }

  get snapshot(): ConnectionSnapshot { return this.current; }
  get state(): ConnectionState { return this.current.state; }

  onStateChange(listener: (change: ConnectionStateChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async connect(signal?: AbortSignal): Promise<ServerHello> {
    if (this.current.state === "connected" && this.current.server !== undefined) return this.current.server;
    if (this.closed) throw new ClientDisconnectedError("client has been closed");
    this.setState("connecting");
    await withAbort(this.transport.open(signal), signal);
    if (!this.readerStarted) { this.readerStarted = true; void this.readLoop(); }
    const hello: ClientHello = {
      type: "client_hello",
      protocolMin: 1,
      protocolMax: 1,
      clientId: this.options.clientId ?? id("client"),
      clientVersion: this.options.clientVersion ?? "0.0.0",
      capabilities: [...(this.options.capabilities ?? [])],
      limits: { ...(this.options.limits ?? DEFAULT_LIMITS) },
    };
    this.handshake = this.pendingPromise<ServerHello>();
    try {
      await this.transport.send(encodeFrame(hello, new Uint8Array(), this.options.limits ?? DEFAULT_LIMITS), { signal });
      const server = await withAbort(this.handshake.promise, signal);
      negotiateVersion(hello.protocolMin, hello.protocolMax, server.protocolVersion, server.protocolVersion);
      this.setState("connected", { server, negotiated: { version: server.protocolVersion, limits: this.options.limits ?? DEFAULT_LIMITS, capabilities: server.capabilities } });
      return server;
    } catch (error) {
      this.handshake = undefined;
      const clientError = error instanceof ClientError ? error : new ClientError("disconnected", "connection handshake failed", { retryable: true, cause: error });
      this.setState("failed", { error: clientError });
      throw clientError;
    }
  }

  async query<T extends JsonValue = JsonValue>(operation: string, payload: JsonValue = {}, options: QueryOptions = {}): Promise<ClientQueryResult<T>> {
    this.requireConnected();
    const queryId = options.queryId ?? id("query");
    const result = await this.sendRequest<QueryResultEnvelope>({ type: "query", queryId, operation, payload, ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }) }, options.signal);
    const error = resultError(result);
    if (error !== undefined) throw error;
    return result as ClientQueryResult<T>;
  }

  async command<T extends JsonValue = JsonValue>(operation: string, payload: JsonValue = {}, options: CommandOptions = {}): Promise<ClientCommandResult<T>> {
    this.requireConnected();
    const commandId = options.commandId ?? `${this.options.clientId ?? "client"}-${(++this.commandCounter).toString(36)}-${id("cmd")}`.slice(0, 128);
    const correlationId = id("correlation");
    try {
      const result = await this.sendRequest<CommandResultEnvelope>({
        type: "command", commandId, correlationId, operation, payload,
        ...(options.expectedRevision === undefined ? {} : { expectedRevision: options.expectedRevision }),
        ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
      }, options.signal);
      const error = resultError(result);
      if (error !== undefined) throw error;
      return result as ClientCommandResult<T>;
    } catch (error) {
      if (error instanceof ClientDisconnectedError) throw new CommandOutcomeUnknownError(commandId, error);
      throw error;
    }
  }

  async commandStatus(commandId: string, options: QueryOptions = {}): Promise<ClientCommandResult> {
    const result = await this.query<JsonValue>("command.status", { commandId }, options);
    return result as unknown as ClientCommandResult;
  }

  async resync<T extends JsonValue = JsonValue>(options: ResyncOptions = {}): Promise<ResyncResult<T>> {
    const result = await this.query<JsonValue>(options.operation ?? "workspace.resync", options.payload ?? { revision: this.current.revision, cursor: this.current.cursor }, options);
    const value = result.result;
    if (value === undefined || typeof value !== "object" || value === null || Array.isArray(value)) throw new ClientError("invalid_response", "resync response is invalid");
    const candidate = value as unknown as { revision?: unknown; cursor?: unknown; snapshot?: T; events?: readonly ClientEvent[] };
    if (!Number.isSafeInteger(candidate.revision) || typeof candidate.cursor !== "string" || candidate.snapshot === undefined) throw new ClientError("invalid_response", "resync response is incomplete");
    this.setState("connected", { revision: candidate.revision as number, cursor: candidate.cursor, stale: false });
    return candidate as ResyncResult<T>;
  }

  async subscribe<T = JsonValue>(event: string | undefined, options: SubscriptionOptions = {}): Promise<ClientSubscription<T>> {
    this.requireConnected();
    const subscriptionId = options.subscriptionId ?? id("subscription");
    if (options.operation !== false) await this.command(options.operation ?? "events.subscribe", { subscriptionId, event: event ?? null, fromRevision: options.fromRevision ?? this.current.revision, cursor: options.cursor ?? this.current.cursor, ...(options.payload === undefined ? {} : { payload: options.payload }) }, { signal: options.signal });
    const listeners = new Set<(value: ClientEvent<T>) => void>();
    this.events.set(subscriptionId, listeners as Set<(value: ClientEvent) => void>);
    const unsubscribe = async () => { this.events.delete(subscriptionId); if (options.operation !== false) await this.command("events.unsubscribe", { subscriptionId }, { signal: options.signal }); };
    if (options.signal !== undefined) options.signal.addEventListener("abort", () => { void unsubscribe(); }, { once: true });
    return { id: subscriptionId, ...(event === undefined ? {} : { event }), fromRevision: options.fromRevision ?? this.current.revision, unsubscribe, onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.setState("closing");
    for (const pending of this.pending.values()) pending.reject(new ClientDisconnectedError("client is closing"));
    this.pending.clear();
    this.handshake?.reject(new ClientDisconnectedError("client is closing"));
    await this.transport.close({ code: "normal" });
    this.setState("closed");
  }

  private pendingPromise<T>(): Pending<T> & { readonly promise: Promise<T> } {
    let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
    return { resolve, reject, promise };
  }

  private async sendRequest<T extends QueryResultEnvelope | CommandResultEnvelope>(envelope: Envelope, signal?: AbortSignal): Promise<T> {
    const key = envelope.type === "query" ? envelope.queryId : envelope.type === "command" ? envelope.correlationId : "";
    const pending = this.pendingPromise<T>();
    this.pending.set(key, pending as unknown as Pending<QueryResultEnvelope | CommandResultEnvelope>);
    try {
      await withAbort(this.transport.send(encodeFrame(envelope, new Uint8Array(), this.options.limits ?? DEFAULT_LIMITS), { signal }), signal);
      return await withAbort(pending.promise, signal);
    } finally { this.pending.delete(key); }
  }

  private requireConnected(): void { if (this.current.state !== "connected") throw new ClientDisconnectedError(); }

  private async readLoop(): Promise<void> {
    try {
      for await (const bytes of this.transport.incoming) {
        const frame = decodeFrame(bytes, this.options.limits ?? DEFAULT_LIMITS);
        this.process(frame.envelope);
      }
      if (!this.closed) this.failDisconnected(new Error("transport closed"));
    } catch (error) { if (!this.closed) this.failDisconnected(error); }
  }

  private process(envelope: Envelope): void {
    if (envelope.type === "server_hello") { this.handshake?.resolve(envelope); this.handshake = undefined; return; }
    if (envelope.type === "query_result" || envelope.type === "command_result") { this.pending.get(envelope.type === "query_result" ? envelope.queryId : envelope.correlationId)?.resolve(envelope); return; }
    if (envelope.type === "error") { if (envelope.correlationId !== undefined) this.pending.get(envelope.correlationId)?.reject(new ClientError(envelope.error.code, envelope.error.message, { ...(envelope.error.retryable === undefined ? {} : { retryable: envelope.error.retryable }), ...(envelope.error.details === undefined ? {} : { details: envelope.error.details }) })); return; }
    if (envelope.type === "event") {
      this.setState("connected", { revision: envelope.revision, cursor: envelope.cursor });
      const listeners = this.events.get(envelope.subscriptionId);
      if (listeners !== undefined) for (const listener of listeners) listener(envelope);
    }
  }

  private failDisconnected(cause: unknown): void {
    const error = new ClientDisconnectedError("transport disconnected", cause);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.handshake?.reject(error);
    this.handshake = undefined;
    this.setState("closed", { error });
  }

  private setState(state: ConnectionState, patch: Partial<ConnectionSnapshot> = {}): void {
    const previous = this.current;
    this.current = { ...previous, ...patch, state, ...(state === "connected" ? { stale: false } : {}) };
    if (previous.state === this.current.state && previous.revision === this.current.revision && previous.cursor === this.current.cursor && previous.error === this.current.error) return;
    const change: ConnectionStateChange = { previous, current: this.current };
    for (const listener of this.listeners) listener(change);
  }
}

export type { ReconnectOptions };
