import {
  decodeFrame,
  DEFAULT_PROTOCOL_LIMITS,
  encodeFrame,
  negotiateVersion,
  protocolError,
  validateEnvelope,
  type ByteTransport,
  type ClientHello,
  type CancelEnvelope,
  type CommandEnvelope,
  type CommandResultEnvelope,
  type Envelope,
  type JsonValue,
  type QueryEnvelope,
  type ServerHello,
} from "@terminay/protocol";
import { authError, validateIdentity } from "./auth.js";
import { createOperationDispatcher, type OperationDispatcher } from "./dispatcher.js";
import { OrderedEventJournal } from "./events.js";
import {
  OutboundDeliveryPump,
  OutboundDeliveryError,
  type OutboundDeliverySnapshot,
	type TerminalDeliveryCongestion,
} from "./outboundDelivery.js";
import type {
  AuthenticatedClient,
  AuthenticateClient,
  ConnectionOptions,
  EventReplay,
  OrderedEvent,
  OrderedEventJournalLike,
  ServerCoreOptions,
  ServerConnectionLike,
} from "./types.js";

type State = "new" | "handshaking" | "open" | "closing" | "closed";

/** The application-protocol liveness probe. A client that advertises
 * `connection.heartbeat` promises to issue this query on an interval. */
export const CONNECTION_PING_OPERATION = "connection.ping";
export const CONNECTION_HEARTBEAT_CAPABILITY = "connection.heartbeat";
/**
 * How long a heartbeat client may be silent before the server reaps it.
 *
 * A transport can stop delivering while every datachannel still reports
 * `open`, and no close event ever arrives. Inbound silence is the only
 * evidence the server gets, so it is the signal — six missed 10s pings.
 */
export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 60_000;

interface InFlightRequest {
  readonly controller: AbortController;
  readonly detachConnectionAbort: () => void;
}

function id(): string {
  const value = typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `server-${value}`.slice(0, 128);
}

/** One protocol connection. Authentication and application dispatch remain
 * separate from the concrete transport and from Electron. */
export class ServerConnection implements ServerConnectionLike {
  readonly connectionId: string;
  private currentState: State = "new";
  private authenticatedClient: AuthenticatedClient | undefined;
  private readonly clientCapabilities = new Set<string>();
  private readonly dispatcher: OperationDispatcher;
  private readonly options: ServerCoreOptions;
  private readonly transport: ByteTransport;
  private readonly outbound: OutboundDeliveryPump;
  private readonly journal: OrderedEventJournalLike;
  private readonly authenticate: AuthenticateClient;
  private readonly transportAuthenticatedClient: AuthenticatedClient | undefined;
  private readerTask: Promise<void> | undefined;
  private readonly abortController = new AbortController();
  private readonly inFlightRequests = new Map<string, InFlightRequest>();
  private readonly eventSubscriptions = new Map<string, () => void>();
  private readonly terminalOutputPositions = new Map<string, number>();
  private connectionCleaned = false;
	private heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly heartbeatTimeoutMs: number;
	private readonly onClosed: (() => void) | undefined;
	private readonly onDeliveryDiagnostic: ConnectionOptions["onDeliveryDiagnostic"];
	private closeTask: Promise<void> | undefined;

  constructor(transport: ByteTransport, options: ServerCoreOptions, connectionOptions: ConnectionOptions = {}) {
    this.transport = transport;
    this.options = options;
    this.connectionId = connectionOptions.connectionId ?? id();
    this.journal = options.eventJournal ?? new OrderedEventJournal();
    this.authenticate = options.authenticate ?? ((context) => ({ clientId: context.hello.clientId, authScope: "none" }));
    this.transportAuthenticatedClient = connectionOptions.authenticatedClient;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
    this.dispatcher = createOperationDispatcher(options);
		this.onClosed = connectionOptions.onClosed;
		this.onDeliveryDiagnostic = connectionOptions.onDeliveryDiagnostic;
		this.outbound = new OutboundDeliveryPump(
			transport,
			{ maxQueuedBytes: options.limits?.maxQueuedBytes ?? DEFAULT_PROTOCOL_LIMITS.maxQueuedBytes },
			(error, snapshot) => this.handleOutboundFailure(error, snapshot),
			(congestion) => this.handleTerminalCongestion(congestion),
		);
  }

  get state(): State { return this.currentState; }
  get client(): AuthenticatedClient | undefined { return this.authenticatedClient; }

  async start(signal?: AbortSignal): Promise<void> {
    if (this.currentState !== "new") return;
    this.currentState = "handshaking";
		try {
			await this.transport.open(signal);
		} catch (cause) {
			const reason = { code: "unavailable" as const, message: "transport failed to open", cause };
			this.outbound.close(reason);
			this.abortController.abort(cause);
			this.cleanupConnection();
			this.currentState = "closed";
			this.reportDeliveryDiagnostic({ phase: "closed", code: reason.code, queuedBytes: 0, queuedFrames: 0 });
			throw cause;
		}
    this.readerTask = this.readLoop();
    await this.readerTask;
  }

  async process(frame: Uint8Array, body = new Uint8Array()): Promise<void> {
    const decoded = decodeFrame(frame, this.options.limits);
    await this.processEnvelope(decoded.envelope, body.byteLength === 0 ? decoded.body : body);
  }

  async subscribe(subscriptionId: string, fromRevision = 0): Promise<EventReplay> {
    if (this.currentState !== "open") throw new Error("connection is not open");
    validateIdentity(subscriptionId, "read");
    const replay = await Promise.resolve(this.journal.replay(fromRevision));
    return { ...replay, events: replay.events.flatMap((event) => {
      const projected = this.projectEvent(event);
      return projected === undefined ? [] : [projected];
    }) };
  }

  async close(reason?: ReturnType<typeof protocolError>): Promise<void> {
		if (this.closeTask !== undefined) return this.closeTask;
		if (this.currentState === "closed") return;
		const closeReason = { code: reason?.code === "unauthorized" ? "unauthorized" as const : "normal" as const, ...(reason?.message === undefined ? {} : { message: reason.message }) };
		this.currentState = "closing";
		this.outbound.close(closeReason);
		this.abortController.abort(reason === undefined ? undefined : new Error(reason.message));
		this.cleanupConnection();
		this.closeTask = (async () => {
			try {
				await this.transport.close(closeReason);
			} finally {
				this.currentState = "closed";
				this.reportDeliveryDiagnostic({ phase: "closed", code: closeReason.code, queuedBytes: 0, queuedFrames: 0 });
			}
		})();
		return this.closeTask;
  }

  private async readLoop(): Promise<void> {
    const inFlight = new Set<Promise<void>>();
    let framesThisTurn = 0;
    try {
      for await (const frame of this.transport.incoming) {
        // Keep the handshake ordered, then let the transport close reach the
        // connection abort signal while a long-running command is in flight.
        // Request correlation ids preserve response ownership after this point.
        this.noteInboundFrame();
        if (this.currentState === "handshaking") {
          await this.process(frame);
          continue;
        }
        const task = this.process(frame).catch(() => undefined);
        inFlight.add(task);
        void task.finally(() => inFlight.delete(task));
        // A MessagePort may already have a populated queue when its transferred
        // endpoint starts. Bound both concurrent dispatch and each microtask
        // turn so Electron's main loop remains responsive under a frame storm.
        if (inFlight.size >= 64) await Promise.race(inFlight);
        framesThisTurn += 1;
        if (framesThisTurn >= 128) {
          framesThisTurn = 0;
          await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
        }
      }
    } finally {
		const disconnected = this.currentState !== "closing";
		if (disconnected) {
			const reason = { code: "unavailable" as const, message: "transport disconnected" };
			this.outbound.close(reason);
			this.abortController.abort(new Error(reason.message));
		}
      await Promise.all([...inFlight]);
		if (disconnected && this.currentState !== "closing") {
        this.cleanupConnection();
        this.currentState = "closed";
			this.reportDeliveryDiagnostic({ phase: "closed", code: "unavailable", queuedBytes: 0, queuedFrames: 0 });
      }
    }
	}

  private async processEnvelope(envelope: Envelope, body: Uint8Array): Promise<void> {
    validateEnvelope(envelope);
    if (this.currentState === "handshaking") {
      if (envelope.type !== "client_hello") { await this.send({ type: "error", error: protocolError("unauthorized", "client hello required") }); return; }
      await this.handleHello(envelope);
      return;
    }
    if (this.currentState !== "open") return;
    if (envelope.type === "query") await this.handleQuery(envelope, body);
    else if (envelope.type === "command") await this.handleCommand(envelope, body);
    else if (envelope.type === "cancel") this.cancelRequest(envelope);
  }

  private async handleHello(hello: ClientHello): Promise<void> {
    let auth: AuthenticatedClient | ReturnType<typeof authError>;
    try {
      auth = this.transportAuthenticatedClient ?? await this.authenticate({ hello, signal: this.abortController.signal });
    } catch { auth = authError(); }
    if ("code" in auth) { await this.send({ type: "error", error: auth }); await this.close(auth); return; }
    validateIdentity(auth.clientId, auth.authScope);
    const version = negotiateVersion(hello.protocolMin, hello.protocolMax);
    this.clientCapabilities.clear();
    for (const capability of hello.capabilities) this.clientCapabilities.add(capability);
    this.authenticatedClient = auth;
    const server: ServerHello = {
      type: "server_hello", protocolVersion: version, serverId: this.options.serverId, serverVersion: this.options.serverVersion,
      clientId: auth.clientId, capabilities: [...this.options.capabilities], limits: { ...(this.options.limits ?? {}) }, authScope: auth.authScope,
    };
    await this.send(server);
    this.currentState = "open";
    // Capabilities are only known once the hello is processed, so the silence
    // deadline for a heartbeat client starts here rather than on its own frame.
    this.noteInboundFrame();
  }

  /**
   * Restart the inbound-silence deadline.
   *
   * Only a client that advertised `connection.heartbeat` is reaped: it has
   * promised to keep proving liveness. A Local Desktop, MCP, or test client
   * that makes no such promise may idle indefinitely.
   */
  private noteInboundFrame(): void {
    if (!this.clientCapabilities.has(CONNECTION_HEARTBEAT_CAPABILITY)) return;
    if (this.heartbeatTimer !== undefined) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = globalThis.setTimeout(() => {
      this.heartbeatTimer = undefined;
      if (this.currentState !== "open") return;
      void this.failConnection(
        new OutboundDeliveryError({ code: "timeout", message: "application heartbeat timed out" }),
      ).catch(() => undefined);
    }, this.heartbeatTimeoutMs);
    this.heartbeatTimer.unref?.();
  }

  private async handleQuery(query: QueryEnvelope, body: Uint8Array): Promise<void> {
    if (query.operation === CONNECTION_PING_OPERATION) {
      // Liveness is answered by the connection itself, so a busy or misconfigured
      // operation registry can never make a live connection look dead.
      await this.send({
        type: "query_result",
        queryId: query.queryId,
        ok: true,
        result: { sentAt: pingSentAt(query.payload), serverTime: Date.now() },
      });
      return;
    }
    const request = this.beginRequest(query.queryId);
    if (request === undefined) {
      await this.send({ type: "query_result", queryId: query.queryId, ok: false, error: duplicateRequestError() });
      return;
    }
    try {
      const result = await this.dispatcher.query({ envelope: query, body, context: this.context(query, request.controller.signal) });
      await this.send(result.envelope, result.body);
    } catch (error) {
      await this.send({ type: "query_result", queryId: query.queryId, ok: false, error: responseFailureError(error) }).catch(() => undefined);
    } finally {
      this.finishRequest(query.queryId, request);
    }
  }

  private async handleCommand(command: CommandEnvelope, body: Uint8Array): Promise<void> {
    const request = this.beginRequest(command.correlationId);
    if (request === undefined) {
      await this.send({ type: "command_result", commandId: command.commandId, correlationId: command.correlationId, ok: false, error: duplicateRequestError() });
      return;
    }
    try {
      if (command.operation === "events.subscribe") {
        const result = await this.validateEventSubscription(command);
        await this.send(result);
        if (result.ok) await this.activateEventSubscription(command);
        return;
      }
      if (command.operation === "events.unsubscribe") {
        const result = this.unsubscribeEventSubscription(command);
        await this.send(result);
        return;
      }
      const result = await this.dispatcher.command({ envelope: command, body, context: this.context(command, request.controller.signal) });
			this.applyTerminalDeliveryCommand(command, result);
			await this.send(result);
    } catch (error) {
      await this.send({ type: "command_result", commandId: command.commandId, correlationId: command.correlationId, ok: false, error: responseFailureError(error) }).catch(() => undefined);
    } finally {
      this.finishRequest(command.correlationId, request);
    }
  }

  private beginRequest(correlationId: string): InFlightRequest | undefined {
    if (this.inFlightRequests.has(correlationId)) return undefined;
    const controller = new AbortController();
    const onConnectionAbort = (): void => controller.abort(this.abortController.signal.reason);
    this.abortController.signal.addEventListener("abort", onConnectionAbort, { once: true });
    if (this.abortController.signal.aborted) controller.abort(this.abortController.signal.reason);
    const request = { controller, detachConnectionAbort: () => this.abortController.signal.removeEventListener("abort", onConnectionAbort) };
    this.inFlightRequests.set(correlationId, request);
    return request;
  }

  private finishRequest(correlationId: string, request: InFlightRequest): void {
    if (this.inFlightRequests.get(correlationId) !== request) return;
    this.inFlightRequests.delete(correlationId);
    request.detachConnectionAbort();
  }

  private cancelRequest(cancel: CancelEnvelope): void {
    this.inFlightRequests.get(cancel.correlationId)?.controller.abort(new Error("operation cancelled"));
  }

  private async validateEventSubscription(command: CommandEnvelope): Promise<CommandResultEnvelope> {
    if (this.authenticatedClient?.authScope === "none") return commandError(command, "forbidden", "event subscription requires read access");
    // A bounded journal can require a feature snapshot refresh. Refuse to
    // create a subscription for peers that cannot decode that explicit signal
    // instead of silently leaving a legacy client permanently stale.
    if (!this.clientCapabilities.has("events.resync")) return commandError(command, "validation", "event subscription requires events.resync capability");
    const payload = objectPayload(command.payload);
    const subscriptionId = payload.subscriptionId;
    if (!isSafeId(subscriptionId)) return commandError(command, "validation", "event subscription id is invalid");
    const event = payload.event === null || payload.event === undefined ? undefined : payload.event;
    if (event !== undefined && (typeof event !== "string" || event.length === 0 || event.length > 256)) return commandError(command, "validation", "event name is invalid");
    if (payload.payload !== undefined && (typeof payload.payload !== "object" || payload.payload === null || Array.isArray(payload.payload))) {
      return commandError(command, "validation", "event subscription selector is invalid");
    }
    const fromRevision = payload.fromRevision === undefined ? 0 : payload.fromRevision;
    if (!Number.isSafeInteger(fromRevision) || (fromRevision as number) < 0) return commandError(command, "validation", "event revision is invalid");
    return {
      type: "command_result",
      commandId: command.commandId,
      correlationId: command.correlationId,
      ok: true,
      result: { subscriptionId, ...(event === undefined ? {} : { event }), fromRevision: fromRevision as number },
    };
  }

  private unsubscribeEventSubscription(command: CommandEnvelope): CommandResultEnvelope {
    if (this.authenticatedClient?.authScope === "none") return commandError(command, "forbidden", "event subscription requires read access");
    const subscriptionId = objectPayload(command.payload).subscriptionId;
    if (!isSafeId(subscriptionId)) return commandError(command, "validation", "event subscription id is invalid");
    this.eventSubscriptions.get(subscriptionId)?.();
    this.eventSubscriptions.delete(subscriptionId);
    return { type: "command_result", commandId: command.commandId, correlationId: command.correlationId, ok: true, result: { subscriptionId, unsubscribed: true } };
  }

  private async activateEventSubscription(command: CommandEnvelope): Promise<void> {
    if (this.currentState !== "open") return;
    const payload = objectPayload(command.payload);
    const subscriptionId = payload.subscriptionId;
    if (!isSafeId(subscriptionId)) return;
    const event = payload.event === null || payload.event === undefined ? undefined : typeof payload.event === "string" ? payload.event : undefined;
    const selector = payload.payload as JsonValue | undefined;
    const fromRevision = (payload.fromRevision ?? 0) as number;
    this.eventSubscriptions.get(subscriptionId)?.();
    const pending: OrderedEvent[] = [];
    const replayedRevisions = new Set<number>();
    let replaying = true;
    const listener = (value: OrderedEvent): void => {
      const projected = this.projectEvent(value);
      if (projected === undefined || !matchesEvent(projected, this.authenticatedClient?.clientId, event) || !matchesEventSelector(projected.payload, selector)) return;
      if (replaying) pending.push(projected);
      else void this.sendEvent(subscriptionId, projected).catch(() => undefined);
    };
    const unsubscribe = this.journal.subscribe(listener);
    this.eventSubscriptions.set(subscriptionId, unsubscribe);
    const replay = await Promise.resolve(this.journal.replay(fromRevision));
    if (replay.kind === "resync") {
      // A generic journal snapshot is not necessarily authorized for this
      // client (event projection is per event). Send only a watermark; each
      // feature owns the scoped snapshot operation it must refresh from.
      if (this.clientCapabilities.has("events.resync")) {
        const snapshot = replay.snapshot;
        await this.send({ type: "event_resync", subscriptionId, revision: snapshot?.revision ?? fromRevision, cursor: snapshot?.cursor ?? String(fromRevision) });
      }
      replaying = false;
      for (const value of pending) {
        if (terminalOutputMetadata(value) !== undefined) await this.sendEvent(subscriptionId, value);
      }
      return;
    }
    for (const value of replay.events) {
      const projected = this.projectEvent(value);
      if (projected !== undefined && matchesEvent(projected, this.authenticatedClient?.clientId, event)) {
        replayedRevisions.add(projected.revision);
        await this.sendEvent(subscriptionId, projected);
      }
    }
    replaying = false;
    for (const value of pending) {
      if (terminalOutputMetadata(value) !== undefined || (value.revision > fromRevision && !replayedRevisions.has(value.revision))) {
        await this.sendEvent(subscriptionId, value);
      }
    }
  }

  private context(request: QueryEnvelope | CommandEnvelope, signal: AbortSignal = this.abortController.signal) {
    return { connectionId: this.connectionId, clientId: this.authenticatedClient?.clientId ?? "unknown", authScope: this.authenticatedClient?.authScope ?? "none", ...(this.authenticatedClient?.permissions === undefined ? {} : { permissions: this.authenticatedClient.permissions }), ...(this.authenticatedClient?.claims === undefined ? {} : { claims: this.authenticatedClient.claims }), signal, ...(request.deadlineMs === undefined ? {} : { deadline: Date.now() + request.deadlineMs }), ...(request.type === "command" && request.expectedRevision === undefined ? {} : request.type === "command" ? { expectedRevision: request.expectedRevision } : {}) };
  }

  private async send(envelope: Envelope, body: Uint8Array = new Uint8Array()): Promise<void> {
		await this.outbound.send(encodeFrame(envelope, body, this.options.limits));
	}

	private applyTerminalDeliveryCommand(
		command: CommandEnvelope,
		result: CommandResultEnvelope,
	): void {
		if (!result.ok) return;
		if (command.operation === "terminal.attach" || command.operation === "terminal.resume") {
			// A replaced attachment's lane keeps its congestion and resynchronization
			// state. Retire it with the attachment so the replacement starts on a
			// clean scheduler and the superseded lane cannot leak.
			const replaced = objectPayload(result.result).replacedAttachmentId;
			if (isSafeId(replaced)) {
				this.outbound.releaseTerminal(replaced);
				this.terminalOutputPositions.delete(replaced);
			}
			return;
		}
		const payload = objectPayload(command.payload);
		const attachmentId = payload.attachmentId;
		if (!isSafeId(attachmentId)) return;
		if (command.operation === "terminal.ack") {
			const position = payload.position;
			if (typeof position === "number")
				this.outbound.acknowledgeTerminal(attachmentId, position);
		} else if (command.operation === "terminal.detach") {
			this.outbound.releaseTerminal(attachmentId);
			this.terminalOutputPositions.delete(attachmentId);
		}
	}

	private async sendEvent(subscriptionId: string, event: OrderedEvent): Promise<void> {
		const envelope = eventEnvelope(subscriptionId, event);
		const output = terminalOutputMetadata(event);
		if (output === undefined) {
			// Subscription events are reconstructible projections, never RPC
			// control. Keep them outside the fatal reliable-control queue even for
			// features that do not yet have a semantic coalescing key. Full snapshot
			// projections coalesce aggressively; ordered deltas retain unique keys
			// until the bounded lane replaces them with event_resync.
			await this.outbound.sendState(encodeFrame(envelope, new Uint8Array(), this.options.limits), {
				laneId: subscriptionId,
				key: projectionDeliveryKey(event),
				createResyncFrame: () => encodeFrame({
					type: 'event_resync',
					subscriptionId,
					revision: event.revision,
					cursor: event.cursor,
				}, new Uint8Array(), this.options.limits),
			});
			return;
		}
		const binaryBody = terminalOutputBody(event, output);
		const useBinaryBody =
			binaryBody !== undefined &&
			this.clientCapabilities.has('terminal.binary-output');
		const terminalEnvelope = terminalOutputEnvelope(
			subscriptionId,
			event,
			binaryBody,
			useBinaryBody,
		);
		// Event subscriptions are intentionally independent, so overlapping
		// selectors may project the same journal event more than once. Terminal
		// output is different: every copy targets one attachment delivery lane.
		// Admit each byte range once per connection/attachment or duplicate
		// subscriptions would double its queued bytes and advance the lane twice.
		// Raw output is live-only and deliberately does not advance the generic
		// journal revision, so its attachment-owned position is the authority.
		const deliveredPosition = this.terminalOutputPositions.get(output.attachmentId);
		if (deliveredPosition !== undefined && output.nextPosition <= deliveredPosition)
			return;
		this.terminalOutputPositions.set(output.attachmentId, output.nextPosition);
		await this.outbound.sendTerminal(
			encodeFrame(
				terminalEnvelope,
				useBinaryBody ? binaryBody : new Uint8Array(),
				this.options.limits,
			),
			{
				laneId: output.attachmentId,
				position: output.position,
				nextPosition: output.nextPosition,
				createResyncFrame: ({ confirmedPosition, headPosition }) =>
					encodeFrame(
						eventEnvelope(subscriptionId, {
							...event,
							payload: {
								clientId: output.clientId,
								attachmentId: output.attachmentId,
								type: "resync_required",
								serverId: output.serverId,
								projectId: output.projectId,
								sessionId: output.sessionId,
								fromPosition: confirmedPosition,
								replayFrom: headPosition,
								outputPosition: headPosition,
							},
						}),
						new Uint8Array(),
						this.options.limits,
					),
			},
		);
	}

	private handleTerminalCongestion(congestion: TerminalDeliveryCongestion): void {
		const clientId = this.authenticatedClient?.clientId;
		if (clientId !== undefined) {
			try {
				this.options.onTerminalCongestion?.(congestion.laneId, clientId, this.connectionId);
			} catch {
				/* Output suppression cannot affect connection delivery. */
			}
		}
		this.reportDeliveryDiagnostic({
			phase: "terminal_congestion",
			code: "resource",
			queuedBytes: congestion.queuedBytes,
			queuedFrames: congestion.queuedFrames,
			attachmentId: congestion.laneId,
			confirmedPosition: congestion.confirmedPosition,
			headPosition: congestion.headPosition,
		});
	}

	private handleOutboundFailure(error: OutboundDeliveryError, snapshot: OutboundDeliverySnapshot): void {
		this.reportDeliveryDiagnostic({
			phase: "failure",
			code: error.reason.code,
			queuedBytes: snapshot.queuedBytes,
			queuedFrames: snapshot.queuedFrames,
		});
		void this.failConnection(error).catch(() => undefined);
	}

	private async failConnection(error: OutboundDeliveryError): Promise<void> {
		if (this.closeTask !== undefined || this.currentState === "closed") return this.closeTask;
		this.currentState = "closing";
		this.abortController.abort(error);
		this.cleanupConnection();
		this.closeTask = (async () => {
			try {
				await this.transport.close(error.reason);
			} finally {
				this.currentState = "closed";
				this.reportDeliveryDiagnostic({ phase: "closed", code: error.reason.code, queuedBytes: 0, queuedFrames: 0 });
			}
		})();
		return this.closeTask;
	}

	private reportDeliveryDiagnostic(diagnostic: Parameters<NonNullable<ConnectionOptions["onDeliveryDiagnostic"]>>[0]): void {
		try { this.onDeliveryDiagnostic?.(diagnostic); } catch { /* Diagnostic sinks cannot affect connection lifecycle. */ }
	}

  private projectEvent(event: OrderedEvent): OrderedEvent | undefined {
    return this.options.projectEvent === undefined
      ? event
      : this.options.projectEvent(event, this.authenticatedClient);
  }

  private cleanupConnection(): void {
    if (this.connectionCleaned) return;
    this.connectionCleaned = true;
    for (const request of this.inFlightRequests.values()) {
      request.controller.abort(this.abortController.signal.reason);
      request.detachConnectionAbort();
    }
    this.inFlightRequests.clear();
    if (this.heartbeatTimer !== undefined) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    for (const unsubscribe of this.eventSubscriptions.values()) unsubscribe();
    this.eventSubscriptions.clear();
		this.terminalOutputPositions.clear();
    const clientId = this.authenticatedClient?.clientId;
    if (clientId !== undefined) this.options.onConnectionClosed?.(this.connectionId, clientId);
		this.onClosed?.();
  }
}

function projectionDeliveryKey(event: OrderedEvent): string {
	if (event.event === 'agent') return 'agent:snapshot';
	if (event.event === 'activity') {
		const payload = objectPayload(event.payload);
		if (typeof payload.sessionId === 'string') return `activity:${payload.sessionId}`;
	}
	return `${event.event}:revision:${event.revision}`;
}

export interface ServerCore { readonly accept: (transport: ByteTransport, options?: ConnectionOptions) => ServerConnection; }

export function createServerCore(options: ServerCoreOptions): ServerCore {
  let connections = 0;
  return {
		accept: (transport, connectionOptions = {}) => {
			if (options.maxConnections !== undefined && connections >= options.maxConnections) throw new Error("server connection limit reached");
			connections += 1;
			let released = false;
			return new ServerConnection(transport, options, {
				...connectionOptions,
				onClosed: () => {
					if (!released) { released = true; connections -= 1; }
					connectionOptions.onClosed?.();
				},
			});
		},
	};
}

function pingSentAt(payload: unknown): number | null {
  const value = objectPayload(payload).sentAt;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function objectPayload(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};
}

function isSafeId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value); }

function commandError(command: CommandEnvelope, code: "forbidden" | "validation", message: string): CommandResultEnvelope {
  return { type: "command_result", commandId: command.commandId, correlationId: command.correlationId, ok: false, error: { code, message } };
}

function duplicateRequestError() {
  return { code: "validation" as const, message: "request correlation id is already in flight", retryable: false };
}

function responseFailureError(error: unknown) {
  if (error instanceof RangeError && /(?:header|body|frame).*limit|frame exceeds|body exceeds|header exceeds/u.test(error.message)) {
    return protocolError("resource", "response exceeded protocol limits", { retryable: false });
  }
  if (error instanceof Error && error.name === "AbortError") return protocolError("cancelled", "operation cancelled");
  return protocolError("internal", error instanceof Error ? error.message : "operation failed");
}

function matchesEvent(event: OrderedEvent, clientId: string | undefined, name: string | undefined): boolean {
  if (name !== undefined && event.event !== name) return false;
  const payload = objectPayload(event.payload);
  return typeof payload.clientId !== "string" || payload.clientId === clientId;
}

function matchesEventSelector(payload: JsonValue, selector: JsonValue | undefined): boolean {
  if (selector === undefined) return true;
  if (typeof selector !== "object" || selector === null || Array.isArray(selector)) return false;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return false;
  const candidate = payload as Record<string, JsonValue>;
  for (const [key, expected] of Object.entries(selector)) {
    if (typeof expected === "object" && expected !== null) return false;
    if (candidate[key] !== expected) return false;
  }
  return true;
}

interface TerminalOutputMetadata {
	readonly attachmentId: string;
	readonly clientId: string;
	readonly serverId: string;
	readonly projectId: string;
	readonly sessionId: string;
	readonly position: number;
	readonly nextPosition: number;
}

function terminalOutputMetadata(event: OrderedEvent): TerminalOutputMetadata | undefined {
	if (event.event !== "terminal") return undefined;
	const payload = objectPayload(event.payload);
	if (
		payload.type !== "output" ||
		!isSafeId(payload.attachmentId) ||
		typeof payload.clientId !== "string" ||
		typeof payload.serverId !== "string" ||
		typeof payload.projectId !== "string" ||
		typeof payload.sessionId !== "string" ||
		!Number.isSafeInteger(payload.position) ||
		!Number.isSafeInteger(payload.nextPosition) ||
		(payload.position as number) < 0 ||
		(payload.nextPosition as number) <= (payload.position as number)
	) return undefined;
	return {
		attachmentId: payload.attachmentId,
		clientId: payload.clientId,
		serverId: payload.serverId,
		projectId: payload.projectId,
		sessionId: payload.sessionId,
		position: payload.position as number,
		nextPosition: payload.nextPosition as number,
	};
}

function terminalOutputBody(
	event: OrderedEvent,
	output: TerminalOutputMetadata,
): Uint8Array | undefined {
	if (event.body === undefined) return undefined;
	if (!(event.body instanceof Uint8Array))
		throw new TypeError('terminal output body is invalid');
	if (event.body.byteLength !== output.nextPosition - output.position)
		throw new TypeError('terminal output body does not match its byte range');
	return event.body;
}

function terminalOutputEnvelope(
	subscriptionId: string,
	event: OrderedEvent,
	body: Uint8Array | undefined,
	useBinaryBody: boolean,
): Envelope {
	if (useBinaryBody) return eventEnvelope(subscriptionId, event);
	const payload = objectPayload(event.payload);
	const bytes =
		typeof payload.bytes === 'string'
			? payload.bytes
			: body === undefined
				? undefined
				: encodeBase64(body);
	if (bytes === undefined)
		throw new TypeError('legacy terminal output bytes are unavailable');
	return {
		type: 'event',
		subscriptionId,
		revision: event.revision,
		cursor: event.cursor,
		event: event.event,
		payload: { ...payload, bytes },
	};
}

function encodeBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function eventEnvelope(subscriptionId: string, event: OrderedEvent): Envelope {
  return { type: "event", subscriptionId, revision: event.revision, cursor: event.cursor, event: event.event, payload: event.payload };
}
