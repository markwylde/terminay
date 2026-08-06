import type {
  AuthScope,
  ByteTransport,
  ClientHello,
  CommandEnvelope,
  JsonValue,
  ProtocolError,
  ProtocolId,
  ProtocolLimits,
  QueryEnvelope,
	TransportCloseCode,
} from "@terminay/protocol";

/** A canonical identity returned by the transport/application authenticator. */
export interface AuthenticatedClient {
  /** Identity from the authentication layer, never from hello.authScope. */
  readonly clientId: ProtocolId;
  readonly authScope: AuthScope;
  /** Optional transport/application claims. Claims are never sent back to clients. */
  readonly claims?: JsonValue;
}

export interface AuthenticationContext {
  readonly hello: ClientHello;
  readonly signal: AbortSignal;
}

export type AuthenticationResult = AuthenticatedClient | ProtocolError;

export type AuthenticateClient = (
  context: AuthenticationContext,
) => AuthenticationResult | Promise<AuthenticationResult>;

export interface ServerIdentity {
  readonly serverId: ProtocolId;
  readonly serverVersion: string;
  readonly capabilities: readonly string[];
  readonly limits?: ProtocolLimits;
}

export interface RequestContext {
  readonly connectionId: ProtocolId;
  readonly clientId: ProtocolId;
  readonly authScope: AuthScope;
  readonly claims?: JsonValue;
  readonly signal: AbortSignal;
  readonly deadline?: number;
  readonly expectedRevision?: number;
}

export interface QueryRequest {
  readonly envelope: QueryEnvelope;
  readonly body: Uint8Array;
  readonly context: RequestContext;
}

export interface CommandRequest {
  readonly envelope: CommandEnvelope;
  readonly body: Uint8Array;
  readonly context: RequestContext;
}

export interface BinaryQueryHandlerResult {
  readonly result: JsonValue;
  readonly body: Uint8Array;
}

export type QueryHandler = (
  request: QueryRequest,
) => JsonValue | BinaryQueryHandlerResult | Promise<JsonValue | BinaryQueryHandlerResult>;

export interface CommandHandlerResult {
  readonly result?: JsonValue;
  readonly revision?: number;
}

export type CommandHandler = (
  request: CommandRequest,
) => CommandHandlerResult | JsonValue | Promise<CommandHandlerResult | JsonValue>;

export interface OperationPolicy {
  readonly scope?: AuthScope;
  readonly query?: QueryHandler;
  readonly command?: CommandHandler;
}

export interface OperationRegistries {
  readonly queries?: ReadonlyMap<string, QueryHandler> | Record<string, QueryHandler>;
  readonly commands?: ReadonlyMap<string, CommandHandler> | Record<string, CommandHandler>;
  readonly policies?: ReadonlyMap<string, OperationPolicy> | Record<string, OperationPolicy>;
}

export interface OrderedEvent {
  readonly revision: number;
  readonly cursor: string;
  readonly event: string;
  readonly payload: JsonValue;
}

export interface EventSubscription {
  readonly subscriptionId: ProtocolId;
  readonly fromRevision: number;
  readonly signal?: AbortSignal;
}

export interface ResyncSnapshot {
  readonly revision: number;
  readonly cursor: string;
  readonly payload: JsonValue;
}

export interface EventReplay {
  readonly kind: "events" | "resync";
  readonly events: readonly OrderedEvent[];
  readonly snapshot?: ResyncSnapshot;
}

export type EventListener = (event: OrderedEvent) => void;

export interface EventJournalOptions {
  readonly maxEvents?: number;
  readonly initialRevision?: number;
  readonly initialCursor?: string;
  readonly snapshot?: () => ResyncSnapshot | Promise<ResyncSnapshot>;
}

export interface ServerCoreOptions extends ServerIdentity, OperationRegistries {
  readonly authenticate?: AuthenticateClient;
  readonly eventJournal?: OrderedEventJournalLike;
  readonly maxConnections?: number;
  readonly defaultQueryScope?: AuthScope;
  readonly defaultCommandScope?: AuthScope;
  /** Optional server-owned projection applied immediately before a journal
   * event is replayed or sent to an authenticated client. */
  readonly projectEvent?: (event: OrderedEvent, client: AuthenticatedClient | undefined) => OrderedEvent | undefined;
  /** Host-owned cleanup for connection-scoped protocol adapters. */
  readonly onConnectionClosed?: (clientId: ProtocolId) => void;
}

export interface OrderedEventJournalLike {
  readonly revision: number;
  readonly cursor: string;
  append(event: string, payload: JsonValue): OrderedEvent;
  replay(afterRevision?: number): EventReplay | Promise<EventReplay>;
  subscribe(listener: EventListener): () => void;
}

export interface ConnectionOptions {
  readonly connectionId?: ProtocolId;
  readonly signal?: AbortSignal;
  readonly handshakeTimeoutMs?: number;
	/** Internal lifecycle observer; runs exactly once even for unauthenticated
	 * handshakes so connection limits and host tracking cannot leak. */
	readonly onClosed?: () => void;
	/** Metadata-only delivery diagnostics. Frames and application payloads are
	 * intentionally unavailable at this boundary. */
	readonly onDeliveryDiagnostic?: (diagnostic: ConnectionDeliveryDiagnostic) => void;
}

export interface ConnectionDeliveryDiagnostic {
	readonly phase: "failure" | "closed";
	readonly code: TransportCloseCode;
	readonly queuedBytes: number;
	readonly queuedFrames: number;
}

export interface ServerConnectionLike {
  readonly connectionId: ProtocolId;
  readonly state: "new" | "handshaking" | "open" | "closing" | "closed";
  readonly client: AuthenticatedClient | undefined;
  start(signal?: AbortSignal): Promise<void>;
  process(frame: Uint8Array, body?: Uint8Array): Promise<void>;
  subscribe(subscriptionId: ProtocolId, fromRevision?: number): Promise<EventReplay>;
  close(reason?: ProtocolError): Promise<void>;
}

export interface ConnectionFactory {
  accept(transport: ByteTransport, options?: ConnectionOptions): ServerConnectionLike;
}

export function isJsonObject(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAuthenticatedClient(value: unknown): value is AuthenticatedClient {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.clientId === "string" && typeof candidate.authScope === "string";
}
