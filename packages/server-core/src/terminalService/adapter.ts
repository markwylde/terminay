import { TerminalServiceError } from "./errors.js";
import type {
  TerminalAuthorization,
  TerminalCloseReason,
  TerminalEvent,
  TerminalIdentity,
} from "./types.js";
import { TerminalSubscription, type TerminalService } from "./service.js";

/** A sink used by a transport adapter to forward one attached terminal. */
export interface TerminalAttachmentSink {
  readonly onEvent: (event: TerminalEvent) => void;
  readonly onClose?: (reason: TerminalCloseReason) => void;
}

export interface TerminalAttachRequest {
  readonly clientId: string;
  readonly identity: TerminalIdentity;
  readonly authorization?: TerminalAuthorization;
  /** The last output position known by the client. Defaults to zero. */
  readonly fromPosition?: number;
}

export interface TerminalAttachmentSnapshot extends TerminalIdentity {
  readonly attachmentId: string;
  readonly clientId: string;
  readonly fromPosition: number;
  readonly position: number;
  readonly closed: boolean;
}

interface MutableAttachment {
  readonly id: string;
  readonly clientId: string;
  readonly identity: TerminalIdentity;
  readonly key: string;
  readonly sink: TerminalAttachmentSink;
  readonly subscription: TerminalSubscription;
  readonly fromPosition: number;
  closed: boolean;
  position: number;
}

/**
 * Server-side terminal stream adapter for local and remote transports.
 *
 * It intentionally does not know about WebRTC, Electron, or wire frames. A
 * transport gives it an exact session identity and a sink, then forwards
 * events from the resulting attachment. It keeps no cursor memory of its own:
 * an attaching client states where it is, or asks for a fresh checkpoint. A
 * remembered watermark could resume a stream at a position the client never
 * reached, which is a gap the client has no way to detect. Detaching only
 * closes that subscription; the server-owned PTY remains live.
 */
export class TerminalServiceAdapter {
  private readonly service: TerminalService;
  private readonly attachments = new Map<string, MutableAttachment>();
  private readonly byClientSession = new Map<string, string>();
  private attachmentCounter = 0;

  constructor(service: TerminalService) {
    this.service = service;
  }

  get size(): number { return this.attachments.size; }

  attach(request: TerminalAttachRequest, sink: TerminalAttachmentSink): TerminalAttachment {
    validateClientId(request.clientId);
    if (typeof sink?.onEvent !== "function") throw new TypeError("terminal attachment sink must provide onEvent");
    const identity = Object.freeze({ ...request.identity });
    const key = clientSessionKey(request.clientId, identity);
    const priorId = this.byClientSession.get(key);
    if (priorId !== undefined) this.detach(priorId);

    // An omitted cursor means the start of retained replay. The adapter never
    // substitutes a position of its own: the client is the only component that
    // knows what it has actually rendered.
    const fromPosition = request.fromPosition ?? 0;
    validatePosition(fromPosition);
    const initialEvents: TerminalEvent[] = [];
    const id = this.nextAttachmentId(request.clientId);
    let mutable: MutableAttachment | undefined;
    let deliveredPosition = fromPosition;
    let started = false;
    const forward = (event: TerminalEvent): void => {
      if (mutable === undefined || !mutable.closed) sink.onEvent(event);
      if (mutable === undefined) initialEvents.push(event);
    };
    const onEvent = (event: TerminalEvent): void => {
      if (event.type === "skip") {
        deliveredPosition = Math.max(deliveredPosition, event.toPosition);
        started = true;
        forward(event);
        return;
      }
      if (event.type !== "output") {
        forward(event);
        return;
      }
      if (event.nextPosition <= deliveredPosition) return;
      // Retained replay is bounded, so a stream can legitimately begin after
      // the cursor that was asked for. That is a discontinuity the server
      // knows about, and it is stated in band rather than delivered as a gap
      // the client would have to infer.
      if (!started && event.position > deliveredPosition) {
        forward(Object.freeze({
          type: "skip",
          ...identity,
          fromPosition: deliveredPosition,
          toPosition: event.position,
          reason: "congestion",
        }));
        deliveredPosition = event.position;
      }
      // Anything else is a server-side ordering fault. Raising it here would
      // land in the subscription's listener guard and vanish, so close the
      // attachment instead: the client sees an explicit attachment_closed skip
      // and re-attaches from a fresh checkpoint.
      if (event.position !== deliveredPosition) {
        if (mutable !== undefined) queueMicrotask(() => this.closeAttachment(id, "slow_consumer"));
        return;
      }
      started = true;
      deliveredPosition = event.nextPosition;
      if (mutable !== undefined) mutable.position = event.nextPosition;
      forward(event);
    };
    // TerminalService invokes the listener for retained replay before
    // subscribe() returns, so `mutable` needs a temporary shell first.
    const subscription = this.service.subscribe(identity, {
      authorization: request.authorization,
      fromPosition,
      onEvent,
    });
    mutable = {
      id,
      clientId: request.clientId,
      identity,
      key,
      sink,
      subscription,
      fromPosition,
      closed: false,
      position: deliveredPosition,
    };
    // Initial replay was delivered synchronously above. It must remain
    // visible in the returned attachment even though the sink already saw it.
    const attachment = new TerminalAttachment(this, mutable, initialEvents);
    this.attachments.set(id, mutable);
    this.byClientSession.set(key, id);
    return attachment;
  }

  /** Alias used by reconnecting clients. */
  resume(request: TerminalAttachRequest, sink: TerminalAttachmentSink): TerminalAttachment {
    return this.attach(request, sink);
  }

  detach(attachment: string | TerminalAttachment): void {
    const id = typeof attachment === "string" ? attachment : attachment.attachmentId;
    const mutable = this.attachments.get(id);
    if (mutable === undefined) return;
    mutable.closed = true;
    this.attachments.delete(id);
    if (this.byClientSession.get(mutable.key) === id) this.byClientSession.delete(mutable.key);
    mutable.subscription.close("client");
    mutable.sink.onClose?.("client");
  }

  close(reason: TerminalCloseReason = "service_shutdown"): void {
    for (const id of [...this.attachments.keys()]) this.closeAttachment(id, reason);
  }

  /** @internal */
  closeAttachment(id: string, reason: TerminalCloseReason): void {
    const mutable = this.attachments.get(id);
    if (mutable === undefined) return;
    mutable.closed = true;
    this.attachments.delete(id);
    if (this.byClientSession.get(mutable.key) === id) this.byClientSession.delete(mutable.key);
    mutable.subscription.close(reason);
    mutable.sink.onClose?.(reason);
  }

  /** @internal */
  acknowledge(attachment: MutableAttachment, position: number): void {
    if (attachment.closed) throw new TerminalServiceError("session_exited", "terminal attachment is closed");
    validatePosition(position);
    attachment.subscription.ack(position);
    attachment.position = Math.max(attachment.position, position);
  }

  /** @internal */
  snapshot(attachment: MutableAttachment): TerminalAttachmentSnapshot {
    return Object.freeze({
      ...attachment.identity,
      attachmentId: attachment.id,
      clientId: attachment.clientId,
      fromPosition: attachment.fromPosition,
      position: attachment.position,
      closed: attachment.closed,
    });
  }

  private nextAttachmentId(clientId: string): string {
    this.attachmentCounter += 1;
    return `terminal-attachment:${clientId}:${this.attachmentCounter}`.slice(0, 128);
  }
}

export class TerminalAttachment {
  private readonly adapter: TerminalServiceAdapter;
  private readonly mutable: MutableAttachment;
  readonly initialEvents: readonly TerminalEvent[];

  constructor(adapter: TerminalServiceAdapter, mutable: MutableAttachment, initialEvents: readonly TerminalEvent[]) {
    this.adapter = adapter;
    this.mutable = mutable;
    this.initialEvents = initialEvents.map(copyEvent);
  }

  get attachmentId(): string { return this.mutable.id; }
  get clientId(): string { return this.mutable.clientId; }
  get sessionId(): string { return this.mutable.identity.sessionId; }
  get closed(): boolean { return this.mutable.closed; }
  get position(): number { return this.mutable.position; }
  snapshot(): TerminalAttachmentSnapshot { return this.adapter.snapshot(this.mutable); }
  ack(position: number): void { this.adapter.acknowledge(this.mutable, position); }
  detach(): void { this.adapter.detach(this); }
}

function clientSessionKey(clientId: string, identity: TerminalIdentity): string {
  return `${clientId}\u0000${identity.serverId}\u0000${identity.projectId}\u0000${identity.sessionId}`;
}

function validateClientId(value: string): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new TerminalServiceError("invalid_identity", "clientId is invalid");
}

function validatePosition(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new TerminalServiceError("invalid_position", "terminal position must be a non-negative safe integer");
}


function copyEvent(event: TerminalEvent): TerminalEvent {
  if (event.type !== "output") return { ...event };
  const bytes = new Uint8Array(event.bytes);
  return { ...event, bytes, data: bytes };
}
