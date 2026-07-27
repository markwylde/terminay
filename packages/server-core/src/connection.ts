import {
  decodeFrame,
  encodeFrame,
  negotiateVersion,
  protocolError,
  validateEnvelope,
  type ByteTransport,
  type ClientHello,
  type CommandEnvelope,
  type Envelope,
  type QueryEnvelope,
  type ServerHello,
} from "@terminay/protocol";
import { authError, validateIdentity } from "./auth.js";
import { createOperationDispatcher, type OperationDispatcher } from "./dispatcher.js";
import { OrderedEventJournal } from "./events.js";
import type {
  AuthenticatedClient,
  AuthenticateClient,
  ConnectionOptions,
  EventReplay,
  OrderedEventJournalLike,
  ServerCoreOptions,
  ServerConnectionLike,
} from "./types.js";

type State = "new" | "handshaking" | "open" | "closing" | "closed";

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
  private readonly dispatcher: OperationDispatcher;
  private readonly options: ServerCoreOptions;
  private readonly transport: ByteTransport;
  private readonly journal: OrderedEventJournalLike;
  private readonly authenticate: AuthenticateClient;
  private readerTask: Promise<void> | undefined;
  private readonly abortController = new AbortController();

  constructor(transport: ByteTransport, options: ServerCoreOptions, connectionOptions: ConnectionOptions = {}) {
    this.transport = transport;
    this.options = options;
    this.connectionId = connectionOptions.connectionId ?? id();
    this.journal = options.eventJournal ?? new OrderedEventJournal();
    this.authenticate = options.authenticate ?? ((context) => ({ clientId: context.hello.clientId, authScope: "none" }));
    this.dispatcher = createOperationDispatcher(options);
  }

  get state(): State { return this.currentState; }
  get client(): AuthenticatedClient | undefined { return this.authenticatedClient; }

  async start(signal?: AbortSignal): Promise<void> {
    if (this.currentState !== "new") return;
    this.currentState = "handshaking";
    await this.transport.open(signal);
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
    return this.journal.replay(fromRevision);
  }

  async close(reason?: ReturnType<typeof protocolError>): Promise<void> {
    if (this.currentState === "closed") return;
    this.currentState = "closing";
    this.abortController.abort(reason === undefined ? undefined : new Error(reason.message));
    await this.transport.close({ code: reason?.code === "unauthorized" ? "unauthorized" : "normal", ...(reason?.message === undefined ? {} : { message: reason.message }) });
    this.currentState = "closed";
  }

  private async readLoop(): Promise<void> {
    try {
      for await (const frame of this.transport.incoming) await this.process(frame);
    } finally {
      if (this.currentState !== "closing") this.currentState = "closed";
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
    else if (envelope.type === "cancel") { /* handlers receive connection aborts through their request signal */ }
  }

  private async handleHello(hello: ClientHello): Promise<void> {
    let auth: AuthenticatedClient | ReturnType<typeof authError>;
    try { auth = await this.authenticate({ hello, signal: this.abortController.signal }); } catch { auth = authError(); }
    if ("code" in auth) { await this.send({ type: "error", error: auth }); await this.close(auth); return; }
    validateIdentity(auth.clientId, auth.authScope);
    const version = negotiateVersion(hello.protocolMin, hello.protocolMax);
    this.authenticatedClient = auth;
    const server: ServerHello = {
      type: "server_hello", protocolVersion: version, serverId: this.options.serverId, serverVersion: this.options.serverVersion,
      clientId: auth.clientId, capabilities: [...this.options.capabilities], limits: { ...(this.options.limits ?? {}) }, authScope: auth.authScope,
    };
    await this.send(server);
    this.currentState = "open";
  }

  private async handleQuery(query: QueryEnvelope, body: Uint8Array): Promise<void> {
    await this.send(await this.dispatcher.query({ envelope: query, body, context: this.context(query) }));
  }

  private async handleCommand(command: CommandEnvelope, body: Uint8Array): Promise<void> {
    await this.send(await this.dispatcher.command({ envelope: command, body, context: this.context(command) }));
  }

  private context(request: QueryEnvelope | CommandEnvelope) {
    return { connectionId: this.connectionId, clientId: this.authenticatedClient?.clientId ?? "unknown", authScope: this.authenticatedClient?.authScope ?? "none", ...(this.authenticatedClient?.claims === undefined ? {} : { claims: this.authenticatedClient.claims }), signal: this.abortController.signal, ...(request.deadlineMs === undefined ? {} : { deadline: Date.now() + request.deadlineMs }), ...(request.type === "command" && request.expectedRevision === undefined ? {} : request.type === "command" ? { expectedRevision: request.expectedRevision } : {}) };
  }

  private async send(envelope: Envelope): Promise<void> { await this.transport.send(encodeFrame(envelope, new Uint8Array(), this.options.limits)); }
}

export interface ServerCore { readonly accept: (transport: ByteTransport, options?: ConnectionOptions) => ServerConnection; }

export function createServerCore(options: ServerCoreOptions): ServerCore {
  let connections = 0;
  return { accept: (transport, connectionOptions = {}) => { if (options.maxConnections !== undefined && connections >= options.maxConnections) throw new Error("server connection limit reached"); connections += 1; return new ServerConnection(transport, options, connectionOptions); } };
}
