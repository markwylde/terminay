import type { JsonValue } from "@terminay/protocol";
import type {
  ClientCommandResult,
  ClientSubscription,
  CommandOptions,
  SubscriptionOptions,
} from "./types.js";

/** The exact server/project/session identity carried by every terminal call. */
export interface TerminalClientIdentity {
  readonly serverId: string;
  readonly projectId: string;
  readonly sessionId: string;
}

export interface TerminalClientAuthorization extends TerminalClientIdentity {
  readonly clientId?: string;
  readonly scope?: "none" | "read" | "write" | "admin";
}

export interface TerminalClientAttachRequest extends TerminalClientIdentity {
  readonly clientId: string;
  readonly authorization?: TerminalClientAuthorization;
  /** Last byte position observed by this client. Defaults to zero. */
  readonly fromPosition?: number;
}

/** JSON event representation used by the application protocol. */
export type TerminalWireEvent =
  | TerminalWireOutputEvent
  | TerminalWireExitEvent
  | TerminalWireResyncEvent;

export interface TerminalWireOutputEvent extends TerminalClientIdentity {
  readonly type: "output";
  readonly position: number;
  readonly nextPosition: number;
  readonly replay?: boolean;
  /** Base64 bytes when the event has no binary frame body. */
  readonly bytes?: string;
}

export interface TerminalWireExitEvent extends TerminalClientIdentity {
  readonly type: "exit";
  readonly exitCode: number;
  readonly signal: number | null;
  readonly reason?: string;
  readonly at?: number;
}

export interface TerminalWireResyncEvent extends TerminalClientIdentity {
  readonly type: "resync_required";
  readonly fromPosition: number;
  readonly replayFrom: number;
  readonly outputPosition: number;
}

export interface TerminalStreamOutputEvent extends TerminalClientIdentity {
  readonly type: "output";
  readonly position: number;
  readonly nextPosition: number;
  readonly bytes: Uint8Array;
  readonly replay: boolean;
}

export interface TerminalStreamExitEvent extends TerminalClientIdentity {
  readonly type: "exit";
  readonly exitCode: number;
  readonly signal: number | null;
  readonly reason?: string;
  readonly at?: number;
}

export interface TerminalStreamResyncEvent extends TerminalClientIdentity {
  readonly type: "resync_required";
  readonly fromPosition: number;
  readonly replayFrom: number;
  readonly outputPosition: number;
}

export type TerminalStreamEvent =
  | TerminalStreamOutputEvent
  | TerminalStreamExitEvent
  | TerminalStreamResyncEvent;

export interface TerminalAttachResult {
  readonly attachmentId: string;
  readonly fromPosition: number;
  readonly position: number;
  readonly events?: readonly TerminalWireEvent[];
}

export interface TerminalClientTransport {
  readonly command: <T extends JsonValue = JsonValue>(
    operation: string,
    payload?: JsonValue,
    options?: CommandOptions,
  ) => Promise<ClientCommandResult<T> | T>;
  readonly subscribe: <T = JsonValue>(
    event: string | undefined,
    options?: SubscriptionOptions,
  ) => Promise<ClientSubscription<T>>;
}

export interface TerminalClientAttachment {
  readonly attachmentId: string;
  readonly identity: TerminalClientIdentity;
  readonly initialEvents: readonly TerminalStreamEvent[];
  readonly position: number;
  readonly closed: boolean;
  readonly onEvent: (listener: (event: TerminalStreamEvent) => void) => () => void;
  readonly ack: (position: number, options?: CommandOptions) => Promise<void>;
  /** Send input through the exact attachment/session authorization boundary. */
  readonly write: (data: Uint8Array | string, options?: CommandOptions) => Promise<void>;
  /** Resize only the session represented by this attachment. */
  readonly resize: (dimensions: TerminalDimensions, options?: CommandOptions) => Promise<void>;
  /** Request termination of the attached session. */
  readonly kill: (signal?: number | string, options?: CommandOptions) => Promise<void>;
  readonly detach: (options?: CommandOptions) => Promise<void>;
}

export interface TerminalDimensions {
  readonly cols: number;
  readonly rows: number;
}

interface MutableAttachment {
  readonly id: string;
  readonly identity: TerminalClientIdentity;
  readonly clientId: string;
  readonly listeners: Set<(event: TerminalStreamEvent) => void>;
  readonly subscription: ClientSubscription<TerminalWireEvent>;
  unsubscribeEvent: () => void;
  readonly initialEvents: readonly TerminalStreamEvent[];
  position: number;
  closed: boolean;
  detached: Promise<void> | undefined;
}

/**
 * Transport-neutral terminal client contract.
 *
 * A local socket, browser transport, and remote WebRTC transport all expose
 * the same command/subscription surface to this class. The implementation
 * keeps per-client/session high-water marks so a stale reconnect cursor cannot
 * replay bytes already delivered by an earlier attachment.
 */
export class TerminayTerminalClient {
  private readonly attachments = new Map<string, MutableAttachment>();
  private readonly highWatermarks = new Map<string, number>();

  constructor(private readonly transport: TerminalClientTransport) {}

  async attach(request: TerminalClientAttachRequest): Promise<TerminalClientAttachment> {
    return this.open("terminal.attach", request);
  }

  async resume(request: TerminalClientAttachRequest): Promise<TerminalClientAttachment> {
    return this.open("terminal.resume", request);
  }

  async detach(attachment: TerminalClientAttachment, options: CommandOptions = {}): Promise<void> {
    const mutable = [...this.attachments.values()].find((candidate) => candidate.id === attachment.attachmentId);
    if (mutable === undefined) return;
    await this.detachMutable(mutable, options);
  }

  private async open(operation: "terminal.attach" | "terminal.resume", request: TerminalClientAttachRequest): Promise<TerminalClientAttachment> {
    validateIdentity(request);
    validateClientId(request.clientId);
    const key = clientSessionKey(request.clientId, request);
    const prior = this.attachments.get(key);
    if (prior !== undefined) await this.detachMutable(prior);
    const requested = request.fromPosition ?? 0;
    validatePosition(requested);
    const highWatermark = this.highWatermarks.get(key) ?? 0;
    const fromPosition = Math.max(requested, highWatermark);
    const result = await this.invoke<TerminalAttachResult>(operation, {
      clientId: request.clientId,
      identity: identityPayload(request),
      ...(request.authorization === undefined ? {} : { authorization: authorizationPayload(request.authorization) }),
      fromPosition,
    } as { readonly [key: string]: JsonValue });
    validateAttachResult(result);
    if (result.fromPosition < fromPosition || result.position < result.fromPosition) throw new TypeError("terminal attach result position regressed");

    const initialEvents: TerminalStreamEvent[] = [];
    let position = Math.max(fromPosition, highWatermark);
    for (const wireEvent of result.events ?? []) {
      const event = decodeEvent(wireEvent, request, undefined);
      if (!acceptEvent(event, this.highWatermarks, key, position)) continue;
      position = event.type === "output" ? event.nextPosition : position;
      initialEvents.push(event);
    }
    position = Math.max(position, result.position);
    this.highWatermarks.set(key, position);

    const subscription = await this.transport.subscribe<TerminalWireEvent>("terminal", {
      payload: {
        attachmentId: result.attachmentId,
        clientId: request.clientId,
        identity: identityPayload(request),
      },
    });
    const mutable: MutableAttachment = {
      id: result.attachmentId,
      identity: copyIdentity(request),
      clientId: request.clientId,
      listeners: new Set(),
      subscription,
      unsubscribeEvent: () => undefined,
      initialEvents: initialEvents.map(copyEvent),
      position,
      closed: false,
      detached: undefined,
    };
    mutable.unsubscribeEvent = subscription.onEvent((event) => {
      if (mutable.closed) return;
      const decoded = decodeEvent(event.payload, mutable.identity, event.body);
      if (!acceptEvent(decoded, this.highWatermarks, key, mutable.position)) return;
      if (decoded.type === "output") mutable.position = decoded.nextPosition;
      for (const listener of mutable.listeners) listener(copyEvent(decoded));
    });
    this.attachments.set(key, mutable);
    return new AttachmentView(this, mutable);
  }

  private async detachMutable(mutable: MutableAttachment, options: CommandOptions = {}): Promise<void> {
    if (mutable.detached !== undefined) return mutable.detached;
    mutable.detached = (async () => {
      mutable.closed = true;
      mutable.unsubscribeEvent();
      try {
        await mutable.subscription.unsubscribe();
      } finally {
        this.attachments.delete(clientSessionKey(mutable.clientId, mutable.identity));
        await this.invokeVoid("terminal.detach", {
          attachmentId: mutable.id,
          clientId: mutable.clientId,
          identity: identityPayload(mutable.identity),
        }, options);
      }
    })();
    return mutable.detached;
  }

  async acknowledge(mutable: MutableAttachment, position: number, options: CommandOptions = {}): Promise<void> {
    if (mutable.closed) throw new Error("terminal attachment is closed");
    validatePosition(position);
    if (position > mutable.position) throw new RangeError("terminal acknowledgement is ahead of the observed output");
    await this.invokeVoid("terminal.ack", {
      attachmentId: mutable.id,
      clientId: mutable.clientId,
      identity: identityPayload(mutable.identity),
      position,
    }, options);
  }

  async write(mutable: MutableAttachment, data: Uint8Array | string, options: CommandOptions = {}): Promise<void> {
    if (mutable.closed) throw new Error("terminal attachment is closed");
    const bytes = encodeInput(data);
    await this.invokeVoid("terminal.input", {
      attachmentId: mutable.id,
      clientId: mutable.clientId,
      identity: identityPayload(mutable.identity),
      dataBase64: encodeBase64(bytes),
    }, options);
  }

  async resize(mutable: MutableAttachment, dimensions: TerminalDimensions, options: CommandOptions = {}): Promise<void> {
    if (mutable.closed) throw new Error("terminal attachment is closed");
    const normalized = validateDimensions(dimensions);
    await this.invokeVoid("terminal.resize", {
      attachmentId: mutable.id,
      clientId: mutable.clientId,
      identity: identityPayload(mutable.identity),
      ...normalized,
    }, options);
  }

  async kill(mutable: MutableAttachment, signal?: number | string, options: CommandOptions = {}): Promise<void> {
    if (mutable.closed) throw new Error("terminal attachment is closed");
    if (signal !== undefined && ((typeof signal !== "number" && typeof signal !== "string") || (typeof signal === "string" && (signal.length === 0 || signal.length > 32)) || (typeof signal === "number" && !Number.isSafeInteger(signal)))) throw new TypeError("terminal signal is invalid");
    await this.invokeVoid("terminal.kill", {
      attachmentId: mutable.id,
      clientId: mutable.clientId,
      identity: identityPayload(mutable.identity),
      ...(signal === undefined ? {} : { signal }),
    }, options);
  }

  private async invoke<T>(operation: string, payload: JsonValue, options: CommandOptions = {}): Promise<T> {
    const response = await this.transport.command<JsonValue>(operation, payload, options);
    if (isCommandEnvelope(response)) {
      if (response.result === undefined) throw new Error(`terminal operation ${operation} returned no result`);
      return response.result as T;
    }
    return response as T;
  }

  private async invokeVoid(operation: string, payload: JsonValue, options: CommandOptions = {}): Promise<void> {
    const response = await this.transport.command<JsonValue>(operation, payload, options);
    if (isCommandEnvelope(response) && response.ok === false) {
      throw new Error(`terminal operation ${operation} failed`);
    }
  }
}

class AttachmentView implements TerminalClientAttachment {
  constructor(private readonly owner: TerminayTerminalClient, private readonly mutable: MutableAttachment) {}
  get attachmentId(): string { return this.mutable.id; }
  get identity(): TerminalClientIdentity { return this.mutable.identity; }
  get initialEvents(): readonly TerminalStreamEvent[] { return this.mutable.initialEvents; }
  get position(): number { return this.mutable.position; }
  get closed(): boolean { return this.mutable.closed; }
  onEvent(listener: (event: TerminalStreamEvent) => void): () => void {
    if (typeof listener !== "function") throw new TypeError("terminal event listener must be a function");
    this.mutable.listeners.add(listener);
    return () => this.mutable.listeners.delete(listener);
  }
  ack(position: number, options: CommandOptions = {}): Promise<void> { return this.owner.acknowledge(this.mutable, position, options); }
  write(data: Uint8Array | string, options: CommandOptions = {}): Promise<void> { return this.owner.write(this.mutable, data, options); }
  resize(dimensions: TerminalDimensions, options: CommandOptions = {}): Promise<void> { return this.owner.resize(this.mutable, dimensions, options); }
  kill(signal?: number | string, options: CommandOptions = {}): Promise<void> { return this.owner.kill(this.mutable, signal, options); }
  detach(options: CommandOptions = {}): Promise<void> { return this.owner.detach(this, options); }
}

function isCommandEnvelope(value: unknown): value is ClientCommandResult<JsonValue> {
  return typeof value === "object" && value !== null && "ok" in value && "commandId" in value;
}

function validateAttachResult(value: TerminalAttachResult): void {
  if (typeof value !== "object" || value === null || typeof value.attachmentId !== "string" || value.attachmentId.length === 0 || !Number.isSafeInteger(value.fromPosition) || !Number.isSafeInteger(value.position)) throw new TypeError("terminal attach result is invalid");
}

function decodeEvent(event: TerminalWireEvent | JsonValue, identity: TerminalClientIdentity, body: Uint8Array | undefined): TerminalStreamEvent {
  if (typeof event !== "object" || event === null || Array.isArray(event)) throw new TypeError("terminal event is invalid");
  const candidate = event as Record<string, unknown>;
  if (candidate.serverId !== identity.serverId || candidate.projectId !== identity.projectId || candidate.sessionId !== identity.sessionId) throw new Error("terminal event identity mismatch");
  const type = candidate.type;
  if (type === "output") {
    const position = safePosition(candidate.position, "terminal output position");
    const nextPosition = safePosition(candidate.nextPosition, "terminal output position");
    if (nextPosition <= position) throw new TypeError("terminal output position is invalid");
    const bytes = body === undefined ? decodeBase64(typeof candidate.bytes === "string" ? candidate.bytes : "") : new Uint8Array(body);
    if (bytes.byteLength !== nextPosition - position) throw new TypeError("terminal output length does not match its position");
    return Object.freeze({ ...identity, type: "output", position, nextPosition, bytes, replay: candidate.replay === true });
  }
  if (type === "exit") {
    if (!Number.isSafeInteger(candidate.exitCode) || (typeof candidate.signal !== "number" && candidate.signal !== null)) throw new TypeError("terminal exit event is invalid");
    return Object.freeze({ ...identity, type: "exit", exitCode: candidate.exitCode as number, signal: candidate.signal as number | null, ...(typeof candidate.reason === "string" ? { reason: candidate.reason } : {}), ...(typeof candidate.at === "number" ? { at: candidate.at } : {}) });
  }
  if (type === "resync_required") {
    const fromPosition = safePosition(candidate.fromPosition, "terminal resync position");
    const replayFrom = safePosition(candidate.replayFrom, "terminal resync position");
    const outputPosition = safePosition(candidate.outputPosition, "terminal resync position");
    return Object.freeze({ ...identity, type: "resync_required", fromPosition, replayFrom, outputPosition });
  }
  throw new TypeError("unknown terminal event type");
}

function acceptEvent(event: TerminalStreamEvent, marks: Map<string, number>, key: string, position: number): boolean {
  if (event.type !== "output") return true;
  const known = Math.max(position, marks.get(key) ?? 0);
  if (event.nextPosition <= known) return false;
  if (event.position < known) throw new Error("terminal output overlaps an acknowledged position");
  if (event.position > known) throw new Error("terminal output has a retained replay gap");
  marks.set(key, event.nextPosition);
  return true;
}

function copyEvent(event: TerminalStreamEvent): TerminalStreamEvent {
  return event.type === "output" ? { ...event, bytes: new Uint8Array(event.bytes) } : { ...event };
}

function identityPayload(value: TerminalClientIdentity): { readonly [key: string]: JsonValue } {
  return { serverId: value.serverId, projectId: value.projectId, sessionId: value.sessionId };
}

function copyIdentity(value: TerminalClientIdentity): TerminalClientIdentity {
  return { serverId: value.serverId, projectId: value.projectId, sessionId: value.sessionId };
}

function authorizationPayload(value: TerminalClientAuthorization): { readonly [key: string]: JsonValue } {
  return {
    ...identityPayload(value),
    ...(value.clientId === undefined ? {} : { clientId: value.clientId }),
    ...(value.scope === undefined ? {} : { scope: value.scope }),
  };
}

function clientSessionKey(clientId: string, identity: TerminalClientIdentity): string {
  return `${clientId}\u0000${identity.serverId}\u0000${identity.projectId}\u0000${identity.sessionId}`;
}

function validateIdentity(value: TerminalClientIdentity): void {
  for (const name of ["serverId", "projectId", "sessionId"] as const) {
    const part = value[name];
    if (typeof part !== "string" || part.length === 0 || part.length > 128 || hasInvalidIdentityCharacters(part)) throw new TypeError(`terminal ${name} is invalid`);
  }
}

function validateClientId(value: string): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new TypeError("terminal clientId is invalid");
}

function hasInvalidIdentityCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function validatePosition(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("terminal position must be a non-negative safe integer");
}

function validateDimensions(value: TerminalDimensions): TerminalDimensions {
  if (typeof value !== "object" || value === null || !Number.isSafeInteger(value.cols) || !Number.isSafeInteger(value.rows) || value.cols < 2 || value.cols > 1_000 || value.rows < 1 || value.rows > 1_000) throw new RangeError("terminal dimensions are invalid");
  return Object.freeze({ cols: value.cols, rows: value.rows });
}

function encodeInput(value: Uint8Array | string): Uint8Array {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > 1_048_576) throw new RangeError("terminal input is invalid");
  return bytes.slice();
}

function encodeBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function safePosition(value: unknown, message: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(`${message} is invalid`);
  return value as number;
}

function decodeBase64(value: string): Uint8Array {
  if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) throw new TypeError("terminal output bytes are not valid base64");
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
