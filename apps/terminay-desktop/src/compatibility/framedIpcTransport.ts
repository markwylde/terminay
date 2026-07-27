import type { ByteTransport, TransportCloseReason, TransportState } from "@terminay/protocol";

/** The narrow subset implemented by Electron MessagePortMain/MessagePort.
 * Keeping this structural avoids importing Electron into shared protocol code. */
export interface IpcMessagePort {
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onmessageerror: (() => void) | null;
  postMessage(message: unknown): void;
  start?(): void;
  close?(): void;
}

export interface IpcTransportOptions {
  readonly maxQueuedBytes?: number;
  readonly maxFrameBytes?: number;
}

/** Bounded framed adapter for the preload/main MessagePort bridge. `send`
 * resolves when the frame is accepted by the local port queue, never when a
 * remote application command commits. */
export class FramedIpcTransport implements ByteTransport {
  private currentState: TransportState = "opening";
  private readonly maxQueuedBytes: number;
  private readonly maxFrameBytes: number;
  private queued = 0;
  private readonly inbound: Uint8Array[] = [];
  private readonly waiters: Array<{ resolve: (value: IteratorResult<Uint8Array>) => void; reject: (reason?: unknown) => void }> = [];
  private readonly writableWaiters: Array<{ bytes: number; resolve: () => void; reject: (reason?: unknown) => void }> = [];
  private readonly listeners = new Set<(state: TransportState, reason?: TransportCloseReason) => void>();
  private ended = false;

  constructor(private readonly port: IpcMessagePort, options: IpcTransportOptions = {}) {
    this.maxQueuedBytes = options.maxQueuedBytes ?? 16 * 1024 * 1024;
    this.maxFrameBytes = options.maxFrameBytes ?? 8 * 1024 * 1024;
    if (!Number.isSafeInteger(this.maxQueuedBytes) || this.maxQueuedBytes <= 0) throw new RangeError("maxQueuedBytes must be positive");
    if (!Number.isSafeInteger(this.maxFrameBytes) || this.maxFrameBytes <= 0) throw new RangeError("maxFrameBytes must be positive");
    port.onmessage = (event) => this.receive(event.data);
    port.onmessageerror = () => this.fail({ code: "unavailable", message: "IPC message could not be decoded" });
  }

  get state(): TransportState { return this.currentState; }
  get queuedBytes(): number { return this.queued; }
  get bufferedBytes(): number { return this.inbound.reduce((total, frame) => total + frame.byteLength, 0); }
  get incoming(): AsyncIterable<Uint8Array> {
    return { [Symbol.asyncIterator]: () => ({ next: () => this.next(), return: async () => { this.finish(); return { done: true, value: undefined } as IteratorResult<Uint8Array>; } }) };
  }

  async open(): Promise<void> {
    if (this.currentState === "open") return;
    if (this.currentState !== "opening") throw new Error(`IPC transport is ${this.currentState}`);
    this.currentState = "open";
    this.port.start?.();
    this.notifyState();
  }

  async send(frame: Uint8Array): Promise<void> {
    if (!(frame instanceof Uint8Array) || frame.byteLength === 0 || frame.byteLength > this.maxFrameBytes) throw new RangeError("IPC frame size out of bounds");
    if (this.currentState !== "open") throw new Error(`IPC transport is ${this.currentState}`);
    await this.waitForWritable(frame.byteLength);
    this.queued += frame.byteLength;
    this.port.postMessage(frame.slice());
    // MessagePort has no delivery acknowledgement; release the local queue
    // accounting at the next turn and wake blocked senders.
    queueMicrotask(() => { this.queued = Math.max(0, this.queued - frame.byteLength); this.notifyWritable(); });
  }

  async waitForWritable(requiredBytes = 1): Promise<void> {
    if (!Number.isSafeInteger(requiredBytes) || requiredBytes <= 0 || requiredBytes > this.maxQueuedBytes) throw new RangeError("requiredBytes out of bounds");
    if (this.currentState !== "open") throw new Error(`IPC transport is ${this.currentState}`);
    if (this.queued + requiredBytes <= this.maxQueuedBytes) return;
    await new Promise<void>((resolve, reject) => this.writableWaiters.push({ bytes: requiredBytes, resolve, reject }));
  }

  async close(reason: TransportCloseReason = { code: "normal" }): Promise<void> {
    if (this.currentState === "closed" || this.currentState === "failed") return;
    this.currentState = "closing"; this.notifyState(); this.finish(); this.port.close?.(); this.currentState = "closed"; this.notifyState();
    for (const waiter of this.writableWaiters.splice(0)) waiter.reject(new Error(reason.message ?? "IPC transport closed"));
  }

  onStateChange(listener: (state: TransportState, reason?: TransportCloseReason) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  fail(reason: TransportCloseReason = { code: "internal", message: "IPC transport failed" }): void {
    if (this.currentState === "closed" || this.currentState === "failed") return;
    this.currentState = "failed"; this.finish(new Error(reason.message ?? "IPC transport failed")); this.notifyState(reason);
  }

  private receive(value: unknown): void {
    if (this.currentState !== "open" || !(value instanceof Uint8Array) || value.byteLength > this.maxFrameBytes) { if (this.currentState === "open") this.fail({ code: "protocol_error", message: "invalid IPC frame" }); return; }
    const waiter = this.waiters.shift();
    if (waiter !== undefined) waiter.resolve({ done: false, value: value.slice() });
    else this.inbound.push(value.slice());
  }

  private next(): Promise<IteratorResult<Uint8Array>> {
    const value = this.inbound.shift();
    if (value !== undefined) return Promise.resolve({ done: false, value });
    if (this.ended) return Promise.resolve({ done: true, value: undefined } as IteratorResult<Uint8Array>);
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  private finish(error?: Error): void { if (this.ended) return; this.ended = true; for (const waiter of this.waiters.splice(0)) error === undefined ? waiter.resolve({ done: true, value: undefined } as IteratorResult<Uint8Array>) : waiter.reject(error); }
  private notifyWritable(): void { for (const waiter of [...this.writableWaiters]) if (this.queued + waiter.bytes <= this.maxQueuedBytes) { this.writableWaiters.splice(this.writableWaiters.indexOf(waiter), 1); waiter.resolve(); } }
  private notifyState(reason?: TransportCloseReason): void { for (const listener of this.listeners) listener(this.currentState, reason); }
}
