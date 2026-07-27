import { TerminayClient, type TerminayClientOptions } from "@terminay/client-core";
import type { ProtocolId } from "@terminay/protocol";
import { FramedIpcTransport, type IpcMessagePort, type IpcTransportOptions } from "./framedIpcTransport.js";

/** Versioned packet carried across the temporary Desktop IPC bridge. */
export interface ServerScopedIpcPacket {
  readonly type: "terminay.server-frame";
  readonly version: 1;
  readonly serverId: ProtocolId;
  readonly frame: Uint8Array;
}

export interface ServerScopedIpcPort extends IpcMessagePort {
  readonly serverId: ProtocolId;
}

/**
 * Binds an IPC MessagePort to one server identity before framing reaches the
 * shared client. The renderer cannot choose a target per message: every
 * outbound packet carries the fixed identity supplied by the privileged host,
 * and inbound packets with another identity are rejected as protocol errors.
 */
export class ServerScopedIpcMessagePort implements ServerScopedIpcPort {
  readonly serverId: ProtocolId;
  private messageListener: ((event: { readonly data: unknown }) => void) | null = null;
  private messageErrorListener: (() => void) | null = null;

  constructor(private readonly port: IpcMessagePort, serverId: ProtocolId) {
    assertServerId(serverId);
    this.serverId = serverId;
    port.onmessage = (event) => this.receive(event.data);
  }

  get onmessage(): ((event: { readonly data: unknown }) => void) | null { return this.messageListener; }
  set onmessage(listener: ((event: { readonly data: unknown }) => void) | null) {
    this.messageListener = listener;
  }

  get onmessageerror(): (() => void) | null { return this.messageErrorListener; }
  set onmessageerror(listener: (() => void) | null) {
    this.messageErrorListener = listener;
  }

  postMessage(message: unknown): void {
    if (!(message instanceof Uint8Array) || message.byteLength === 0) throw new TypeError("scoped IPC frame must be a non-empty Uint8Array");
    const packet: ServerScopedIpcPacket = Object.freeze({ type: "terminay.server-frame", version: 1, serverId: this.serverId, frame: message.slice() });
    this.port.postMessage(packet);
  }

  start(): void { this.port.start?.(); }
  close(): void { this.port.close?.(); }

  private receive(value: unknown): void {
    if (!isPacket(value) || value.serverId !== this.serverId) {
      this.messageErrorListener?.();
      return;
    }
    this.messageListener?.({ data: value.frame.slice() });
  }
}

export interface DesktopIpcClientOptions extends Omit<TerminayClientOptions, "transport"> {
  readonly port: IpcMessagePort;
  readonly serverId: ProtocolId;
  readonly transport?: IpcTransportOptions;
}

/** Create the shared protocol client over the temporary Electron IPC path. */
export function createDesktopIpcClient(options: DesktopIpcClientOptions): TerminayClient {
  const { port, serverId, transport: transportOptions, ...clientOptions } = options;
  const scopedPort = new ServerScopedIpcMessagePort(port, serverId);
  const framedOptions = {} as { maxQueuedBytes?: number; maxFrameBytes?: number };
  const maxQueuedBytes = transportOptions?.maxQueuedBytes;
  const maxFrameBytes = transportOptions?.maxFrameBytes ?? clientOptions.limits?.maxFrameBytes;
  if (maxQueuedBytes !== undefined) framedOptions.maxQueuedBytes = maxQueuedBytes;
  if (maxFrameBytes !== undefined) framedOptions.maxFrameBytes = maxFrameBytes;
  const transport = new FramedIpcTransport(scopedPort, framedOptions);
  return new TerminayClient({ ...clientOptions, transport });
}

function isPacket(value: unknown): value is ServerScopedIpcPacket {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const packet = value as Record<string, unknown>;
  return packet.type === "terminay.server-frame" && packet.version === 1 && typeof packet.serverId === "string" && packet.frame instanceof Uint8Array && packet.frame.byteLength > 0;
}

function assertServerId(value: unknown): asserts value is ProtocolId {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new TypeError("server id is invalid");
}
