import {
  decodeFrame,
  encodeFrame,
  DEFAULT_PROTOCOL_LIMITS,
  negotiateVersion,
  type ByteTransport,
  type CancelEnvelope,
  type ClientHello,
  type CommandResultEnvelope,
  type Envelope,
  type JsonValue,
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
  type ClientBinaryQueryResult,
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

type Pending<T> = {
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
  readonly settled: boolean;
};

type EventSubscriptionState = {
  readonly listeners: Set<(event: ClientEvent) => void>;
  readonly resyncListeners: Set<(resync: import("./types.js").ClientSubscriptionResync) => void>;
  readonly buffered: ClientEvent[];
  overflow: Error | undefined;
  resync: import("./types.js").ClientSubscriptionResync | undefined;
};

const MAX_PRE_LISTENER_EVENTS = 1_024;

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

function isExpectedDisconnect(error: unknown): boolean {
  return error instanceof ClientDisconnectedError ||
    error instanceof CommandOutcomeUnknownError ||
    (error instanceof ClientError && error.code === "disconnected");
}

/** Transport-neutral application client. Hosts provide only a ByteTransport. */
export class TerminayClient {
  private readonly transport: ByteTransport;
  private readonly options: TerminayClientOptions;
  private readonly listeners = new Set<(change: ConnectionStateChange) => void>();
  private readonly events = new Map<string, EventSubscriptionState>();
  private readonly pending = new Map<string, Pending<{ readonly envelope: QueryResultEnvelope | CommandResultEnvelope; readonly body: Uint8Array }>>();
  private current: ConnectionSnapshot = { state: "idle", revision: 0, cursor: "0", stale: false, reconnectAttempt: 0 };
  private readerStarted = false;
  private handshake: (Pending<ServerHello> & { readonly promise: Promise<ServerHello> }) | undefined;
  private closed = false;
  private transportClosePromise: Promise<void> | undefined;
  private commandCounter = 0;

  constructor(options: TerminayClientOptions) {
    this.transport = options.transport;
    this.options = options;
		if (options.initialWatermark !== undefined) {
			if (
				!Number.isSafeInteger(options.initialWatermark.revision) ||
				options.initialWatermark.revision < 0 ||
				options.initialWatermark.cursor !== String(options.initialWatermark.revision)
			) {
				throw new TypeError("initial connection watermark is invalid");
			}
			this.current = { ...this.current, revision: options.initialWatermark.revision, cursor: options.initialWatermark.cursor, stale: true };
		}
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
      // The capability gates the additive event_resync envelope so older v1
      // peers continue to receive only envelopes they understand.
		capabilities: [
			...new Set([
				...(this.options.capabilities ?? []),
				"events.resync",
				"terminal.binary-output",
			]),
		],
      limits: { ...(this.options.limits ?? DEFAULT_PROTOCOL_LIMITS) },
    };
    const handshake = this.pendingPromise<ServerHello>();
    this.handshake = handshake;
    try {
      await this.transport.send(encodeFrame(hello, new Uint8Array(), this.options.limits ?? DEFAULT_PROTOCOL_LIMITS), { signal });
      const server = await withAbort(handshake.promise, signal);
      negotiateVersion(hello.protocolMin, hello.protocolMax, server.protocolVersion, server.protocolVersion);
      this.setState("connected", { server, negotiated: { version: server.protocolVersion, limits: this.options.limits ?? DEFAULT_PROTOCOL_LIMITS, capabilities: server.capabilities } });
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
    const response = await this.sendRequest<QueryResultEnvelope>({ type: "query", queryId, operation, payload, ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }) }, options.signal);
    const result = response.envelope;
    const error = resultError(result);
    if (error !== undefined) throw error;
    if (response.body.byteLength !== 0) throw new ClientError("invalid_response", "JSON query returned an unexpected binary body");
    return result as ClientQueryResult<T>;
  }

  async queryWithBody<T extends JsonValue = JsonValue>(operation: string, payload: JsonValue = {}, options: QueryOptions = {}): Promise<ClientBinaryQueryResult<T>> {
    this.requireConnected();
    const queryId = options.queryId ?? id("query");
    const response = await this.sendRequest<QueryResultEnvelope>({ type: "query", queryId, operation, payload, ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }) }, options.signal);
    const result = response.envelope;
    const error = resultError(result);
    if (error !== undefined) throw error;
    if (result.bodyLength === undefined || result.bodyLength !== response.body.byteLength) throw new ClientError("invalid_response", "binary query body length is invalid");
    return { envelope: result as ClientQueryResult<T>, body: response.body };
  }

  async command<T extends JsonValue = JsonValue>(operation: string, payload: JsonValue = {}, options: CommandOptions = {}): Promise<ClientCommandResult<T>> {
    return this.commandWithBody<T>(operation, payload, new Uint8Array(), options);
  }

  /**
   * Send a command with a bounded binary body.  The JSON envelope remains the
   * operation metadata; callers use this for server-owned uploads such as
   * dictation audio without base64 expansion or exposing a provider API.
   */
  async commandWithBody<T extends JsonValue = JsonValue>(operation: string, payload: JsonValue = {}, body = new Uint8Array(), options: CommandOptions = {}): Promise<ClientCommandResult<T>> {
    this.requireConnected();
    if (!(body instanceof Uint8Array)) throw new TypeError("command body must be Uint8Array");
    const commandId = options.commandId ?? `${this.options.clientId ?? "client"}-${(++this.commandCounter).toString(36)}-${id("cmd")}`.slice(0, 128);
    const correlationId = id("correlation");
    try {
      const response = await this.sendRequest<CommandResultEnvelope>({
        type: "command", commandId, correlationId, operation, payload,
        ...(options.expectedRevision === undefined ? {} : { expectedRevision: options.expectedRevision }),
        ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
      }, options.signal, body);
      const result = response.envelope;
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
    const state: EventSubscriptionState = { listeners: new Set(), resyncListeners: new Set(), buffered: [], overflow: undefined, resync: undefined };
    this.events.set(subscriptionId, state);
    try {
      // A server may emit replay/live frames in the same turn as the command
      // result. Reserve and buffer the route before asking it to activate.
      if (options.operation !== false) await this.command(options.operation ?? "events.subscribe", { subscriptionId, event: event ?? null, fromRevision: options.fromRevision ?? this.current.revision, cursor: options.cursor ?? this.current.cursor, ...(options.payload === undefined ? {} : { payload: options.payload }) }, { signal: options.signal });
    } catch (error) {
      this.events.delete(subscriptionId);
      throw error;
    }
    let unsubscribed = false;
    const unsubscribe = async () => {
      if (unsubscribed) return;
      unsubscribed = true;
      this.events.delete(subscriptionId);
      if (options.operation === false) return;
      if (this.current.state !== "connected") return;
      try {
        await this.command("events.unsubscribe", { subscriptionId }, { signal: options.signal });
      } catch (error) {
        if (isExpectedDisconnect(error)) return;
        throw error;
      }
    };
    if (options.signal !== undefined) options.signal.addEventListener("abort", () => { void unsubscribe(); }, { once: true });
    return {
      id: subscriptionId,
      ...(event === undefined ? {} : { event }),
      fromRevision: options.fromRevision ?? this.current.revision,
      unsubscribe,
      onEvent: (listener) => {
        if (state.overflow !== undefined) throw state.overflow;
        state.listeners.add(listener as unknown as (event: ClientEvent) => void);
        // Buffered events predate an outstanding resync and are superseded by
        // the snapshot the consumer is about to refetch. Returning a phantom
        // disposer instead of registering, as this did, is what made a terminal
        // panel's re-attach silent: it subscribed and was never wired up.
        const buffered = state.buffered.splice(0);
        if (state.resync === undefined) {
          buffered.sort((left, right) => left.revision - right.revision);
          for (const queued of buffered) listener(queued as ClientEvent<T>);
        }
        return () => state.listeners.delete(listener as unknown as (event: ClientEvent) => void);
      },
      onResync: (listener) => {
        state.resyncListeners.add(listener);
        if (state.resync !== undefined) listener(state.resync);
        return () => state.resyncListeners.delete(listener);
      },
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.setState("closing");
    this.events.clear();
    for (const pending of this.pending.values()) pending.reject(new ClientDisconnectedError("client is closing"));
    this.pending.clear();
    this.handshake?.reject(new ClientDisconnectedError("client is closing"));
    await this.closeTransport({ code: "normal" });
    this.setState("closed");
  }

  private closeTransport(reason: Parameters<ByteTransport["close"]>[0]): Promise<void> {
    if (this.transportClosePromise !== undefined) return this.transportClosePromise;
    try {
      this.transportClosePromise = Promise.resolve(this.transport.close(reason));
    } catch (error) {
      this.transportClosePromise = Promise.reject(error);
    }
    return this.transportClosePromise;
  }

  private pendingPromise<T>(): Pending<T> & { readonly promise: Promise<T> } {
    let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
    let settled = false;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = (value) => { if (settled) return; settled = true; resolvePromise(value); };
      reject = (error) => { if (settled) return; settled = true; rejectPromise(error); };
    });
    return { resolve, reject, promise, get settled() { return settled; } };
  }

  private async sendRequest<T extends QueryResultEnvelope | CommandResultEnvelope>(envelope: Envelope, signal?: AbortSignal, body = new Uint8Array()): Promise<{ readonly envelope: T; readonly body: Uint8Array }> {
    const key = envelope.type === "query" ? envelope.queryId : envelope.type === "command" ? envelope.correlationId : "";
    const pending = this.pendingPromise<{ readonly envelope: T; readonly body: Uint8Array }>();
    this.pending.set(key, pending as unknown as Pending<{ readonly envelope: QueryResultEnvelope | CommandResultEnvelope; readonly body: Uint8Array }>);
    const frame = encodeFrame(envelope, body, this.options.limits ?? DEFAULT_PROTOCOL_LIMITS);
    let accepted = false;
    let cancellationSent = false;
    const sendCancellation = (): void => {
      if (envelope.type !== "command" || !accepted || pending.settled || cancellationSent) return;
      cancellationSent = true;
      const cancel: CancelEnvelope = { type: "cancel", correlationId: envelope.correlationId, reason: "client-abort" };
      try {
        void this.transport.send(encodeFrame(cancel, new Uint8Array(), this.options.limits ?? DEFAULT_PROTOCOL_LIMITS)).catch(() => undefined);
      } catch {
        // A local abort remains authoritative if the transport is already
        // unavailable while the best-effort cancel is being queued.
      }
    };
    const abortSignal = signal;
    const onAbort = envelope.type === "command" && abortSignal !== undefined ? sendCancellation : undefined;
    try {
      const preAbort = abortError(signal);
      if (preAbort !== undefined) throw preAbort;
      if (abortSignal !== undefined && onAbort !== undefined) abortSignal.addEventListener("abort", onAbort, { once: true });
      const sendPromise = this.transport.send(frame, { signal });
      // Keep the acceptance continuation alive even when the local abort
      // wins first; a transport may accept the frame after its signal fires.
      void sendPromise.then(() => {
        accepted = true;
        if (signal?.aborted) sendCancellation();
      }, () => undefined);
      await withAbort(sendPromise, signal);
      accepted = true;
      // A transport may resolve send() after observing an abort. In that
      // case the command frame was accepted, so still cancel the server work.
      if (signal?.aborted) sendCancellation();
      return await withAbort(pending.promise, signal);
    } finally {
      if (abortSignal !== undefined && onAbort !== undefined) abortSignal.removeEventListener("abort", onAbort);
      this.pending.delete(key);
    }
  }

  private requireConnected(): void { if (this.current.state !== "connected") throw new ClientDisconnectedError(); }

  private async readLoop(): Promise<void> {
    let framesThisTurn = 0;
    try {
      for await (const bytes of this.transport.incoming) {
        const frame = decodeFrame(bytes, this.options.limits ?? DEFAULT_PROTOCOL_LIMITS);
        this.process(frame.envelope, frame.body);
        // MessagePort delivery and immediately-resolved async iterators can
        // otherwise form an unbounded microtask chain. Yield periodically so
        // connection deadlines, renderer input, and diagnostics remain live
        // even if a peer produces an event storm.
        framesThisTurn += 1;
        if (framesThisTurn >= 128) {
          framesThisTurn = 0;
          await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
        }
      }
      if (!this.closed) this.failDisconnected(new Error("transport closed"));
    } catch (error) { if (!this.closed) this.failDisconnected(error); }
  }

  private process(envelope: Envelope, body: Uint8Array = new Uint8Array()): void {
    const diagnostic = (globalThis as typeof globalThis & {
      __terminayClientDiagnostic?: (phase: string) => void;
    }).__terminayClientDiagnostic;
    diagnostic?.(`client.process.${envelope.type}`);
    if (envelope.type === "server_hello") { this.handshake?.resolve(envelope); this.handshake = undefined; return; }
    if (envelope.type === "query_result" || envelope.type === "command_result") {
      this.pending.get(envelope.type === "query_result" ? envelope.queryId : envelope.correlationId)?.resolve({ envelope, body });
      diagnostic?.(`client.complete.${envelope.type}`);
      return;
    }
    if (envelope.type === "error") { if (envelope.correlationId !== undefined) this.pending.get(envelope.correlationId)?.reject(new ClientError(envelope.error.code, envelope.error.message, { ...(envelope.error.retryable === undefined ? {} : { retryable: envelope.error.retryable }), ...(envelope.error.details === undefined ? {} : { details: envelope.error.details }) })); return; }
    if (envelope.type === "event") {
      // Raw terminal presentation has its own byte-position recovery authority
      // and does not advance the server's durable event journal. A delayed
      // terminal frame must therefore never move the generic client watermark
      // backwards after a newer retained event has arrived.
      if (!isTransientTerminalEvent(envelope)) {
        this.setState("connected", { revision: envelope.revision, cursor: envelope.cursor });
      }
      const subscription = this.events.get(envelope.subscriptionId);
      if (subscription === undefined) return;
      // A resync notice reports a hole in history, not the end of the stream.
      // Withholding live events past it left subscriptions permanently deaf:
      // the workspace refreshed once and then never saw another change, so a
      // terminal created afterwards never appeared, while the connection still
      // reported itself connected. Consumers reconcile by revision.
			const event: ClientEvent =
				body.byteLength === 0 ? envelope : { ...envelope, body };
      if (subscription.listeners.size === 0) {
        if (subscription.buffered.length >= MAX_PRE_LISTENER_EVENTS) {
          subscription.overflow = new ClientError("resync_required", "subscription received too many events before a listener was attached", { retryable: true });
          subscription.buffered.length = 0;
        } else {
				subscription.buffered.push(event);
        }
        return;
      }
			for (const listener of subscription.listeners) listener(event);
      diagnostic?.("client.complete.event");
    }
    if (envelope.type === "event_resync") {
      const subscription = this.events.get(envelope.subscriptionId);
      if (subscription === undefined) return;
      // Each notice is a distinct hole. Ignoring later ones because an earlier
      // one was seen leaves the consumer unaware that it is stale again.
      this.setState("connected", { revision: envelope.revision, cursor: envelope.cursor, stale: true });
      const resync = { subscriptionId: envelope.subscriptionId, revision: envelope.revision, cursor: envelope.cursor, ...(envelope.snapshot === undefined ? {} : { snapshot: envelope.snapshot }) };
      subscription.resync = resync;
      subscription.buffered.length = 0;
      for (const listener of subscription.resyncListeners) listener(resync);
    }
  }

  private failDisconnected(cause: unknown): void {
    const error = new ClientDisconnectedError("transport disconnected", cause);
    // The application protocol owns its ByteTransport. If its reader ends while
    // the client is live, terminalize that transport before publishing stale so
    // recovery cannot mistake an open underlying WebRTC lane for a live client.
    // Explicit disposal racing this path observes the same close promise.
    void this.closeTransport({
      code: "unavailable",
      message: "application protocol reader ended unexpectedly",
      cause,
    }).catch(() => undefined);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.handshake?.reject(error);
    this.handshake = undefined;
		this.events.clear();
		this.setState("stale", { error, stale: true });
  }

  private setState(state: ConnectionState, patch: Partial<ConnectionSnapshot> = {}): void {
    const previous = this.current;
    this.current = { ...previous, ...patch, state, ...(state === "connected" && patch.stale === undefined ? { stale: false } : {}) };
    if (previous.state === this.current.state && previous.revision === this.current.revision && previous.cursor === this.current.cursor && previous.error === this.current.error) return;
    const change: ConnectionStateChange = { previous, current: this.current };
    for (const listener of this.listeners) listener(change);
  }
}

export type { ReconnectOptions };

function isTransientTerminalEvent(envelope: Extract<Envelope, { readonly type: "event" }>): boolean {
  if (envelope.event !== "terminal" || typeof envelope.payload !== "object" || envelope.payload === null || Array.isArray(envelope.payload)) return false;
  const type = (envelope.payload as Readonly<Record<string, unknown>>).type;
  return type === "output" || type === "resync_required";
}
