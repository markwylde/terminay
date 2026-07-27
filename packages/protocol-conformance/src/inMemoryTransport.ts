import {
  abortIfSignalled,
  DEFAULT_PROTOCOL_LIMITS,
  validateTransportFrame,
  type ByteTransport,
  type TransportCloseReason,
  type TransportState,
} from "@terminay/protocol";

const DEFAULT_QUEUE_BYTES = DEFAULT_PROTOCOL_LIMITS.maxQueuedBytes;
const DEFAULT_FRAME_BYTES = DEFAULT_PROTOCOL_LIMITS.maxFrameBytes;
const DEFAULT_CLOSE_TIMEOUT_MS = 1_000;

export interface InMemoryTransportOptions {
  /** Maximum bytes accepted in either the outbound or inbound queue. */
  readonly capacityBytes?: number;
  /** Maximum size of one frame accepted by this endpoint. */
  readonly maxFrameBytes?: number;
  /** Delay before an accepted frame is delivered to its peer. */
  readonly deliveryDelayMs?: number;
}

export interface InMemoryTransportPairOptions extends InMemoryTransportOptions {
  readonly leftCapacityBytes?: number;
  readonly rightCapacityBytes?: number;
  readonly leftMaxFrameBytes?: number;
  readonly rightMaxFrameBytes?: number;
  readonly leftDeliveryDelayMs?: number;
  readonly rightDeliveryDelayMs?: number;
  /** Open both endpoints immediately after constructing the pair. */
  readonly autoOpen?: boolean;
}

interface SendWaiter {
  readonly requiredBytes: number;
  readonly resolve: () => void;
  readonly reject: (reason?: unknown) => void;
  readonly signal: AbortSignal | undefined;
  readonly abortHandler: (() => void) | undefined;
}

interface PendingFrame {
  readonly frame: Uint8Array;
  readonly resolve: () => void;
  readonly reject: (reason?: unknown) => void;
}

type IncomingWaiter = {
  readonly resolve: (result: IteratorResult<Uint8Array>) => void;
  readonly reject: (reason?: unknown) => void;
};

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0) throw new RangeError(`${name} must be a positive integer`);
  return result;
}

function nonNegativeInteger(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 0) throw new RangeError(`${name} must be a non-negative integer`);
  return result;
}

function transportError(state: TransportState): Error {
  return new Error(`transport is ${state}`);
}

/**
 * A deterministic, bounded, transport-neutral byte endpoint.
 *
 * The endpoint deliberately copies every frame. This catches accidental use
 * of a mutable caller-owned buffer and mirrors the ownership boundary of a
 * real IPC/data-channel adapter.
 */
export class InMemoryTransport implements ByteTransport {
  private currentState: TransportState = "opening";
  private peer: InMemoryTransport | undefined;
  private readonly capacity: number;
  private readonly maxFrameBytes: number;
  private readonly deliveryDelayMs: number;
  private readonly outbound: PendingFrame[] = [];
  private outboundBytes = 0;
  private readonly inbound: Uint8Array[] = [];
  private inboundBytes = 0;
  private inboundEnded = false;
  private inboundFailure: unknown;
  private readonly incomingWaiters: IncomingWaiter[] = [];
  private readonly writableWaiters: SendWaiter[] = [];
  private readonly stateListeners = new Set<(state: TransportState, reason?: TransportCloseReason) => void>();
  private readonly inboundDrainListeners = new Set<() => void>();
  private pumpScheduled = false;
  private closePromise: Promise<void> | undefined;
  private closeReason: TransportCloseReason | undefined;

  public constructor(options: InMemoryTransportOptions = {}) {
    this.capacity = positiveInteger(options.capacityBytes, DEFAULT_QUEUE_BYTES, "capacityBytes");
    this.maxFrameBytes = positiveInteger(options.maxFrameBytes, DEFAULT_FRAME_BYTES, "maxFrameBytes");
    this.deliveryDelayMs = nonNegativeInteger(options.deliveryDelayMs, 0, "deliveryDelayMs");
  }

  public get state(): TransportState {
    return this.currentState;
  }

  public get queuedBytes(): number {
    return this.outboundBytes;
  }

  public get bufferedBytes(): number {
    return this.inboundBytes;
  }

  public get incoming(): AsyncIterable<Uint8Array> {
    const endpoint = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
        return {
          next: () => endpoint.nextIncoming(),
          return: async () => {
            endpoint.cancelIncomingIterator();
            return { done: true, value: undefined } as IteratorResult<Uint8Array>;
          },
        };
      },
    };
  }

  /** Connect two endpoints created independently. Calling this twice is an error. */
  public connect(peer: InMemoryTransport): void {
    if (peer === this) throw new TypeError("a transport cannot connect to itself");
    if (this.peer !== undefined || peer.peer !== undefined) throw new Error("transport is already connected");
    this.peer = peer;
    peer.peer = this;
    this.schedulePump();
    peer.schedulePump();
  }

  public async open(signal?: AbortSignal): Promise<void> {
    abortIfSignalled(signal);
    if (this.currentState === "open") return;
    if (this.currentState !== "opening") throw transportError(this.currentState);
    this.setState("open");
    this.schedulePump();
  }

  public async send(frame: Uint8Array, options: { readonly signal?: AbortSignal } = {}): Promise<void> {
    abortIfSignalled(options.signal);
    validateTransportFrame(frame, this.maxFrameBytes);
    if (frame.byteLength > this.capacity) throw new RangeError("transport frame exceeds queue capacity");
    if (this.currentState !== "open") throw transportError(this.currentState);
    await this.waitForWritable(frame.byteLength, options.signal);
    abortIfSignalled(options.signal);
    if (this.currentState !== "open") throw transportError(this.currentState);

    const copy = frame.slice();
    await new Promise<void>((resolve, reject) => {
      this.outbound.push({ frame: copy, resolve, reject });
      this.outboundBytes += copy.byteLength;
      // Acceptance into the bounded queue is the send() guarantee. Delivery
      // and application acknowledgement are intentionally separate events.
      resolve();
      this.schedulePump();
    });
  }

  public async waitForWritable(requiredBytes = 1, signal?: AbortSignal): Promise<void> {
    abortIfSignalled(signal);
    if (!Number.isSafeInteger(requiredBytes) || requiredBytes <= 0 || requiredBytes > this.capacity) {
      throw new RangeError("requiredBytes exceeds transport capacity");
    }
    if (this.currentState !== "open") throw transportError(this.currentState);
    if (this.outboundBytes + requiredBytes <= this.capacity) return;

    await new Promise<void>((resolve, reject) => {
      const abortHandler = signal === undefined ? undefined : () => {
        this.removeWritableWaiter(waiter);
        reject(signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted", "AbortError"));
      };
      const waiter: SendWaiter = { requiredBytes, resolve, reject, signal, abortHandler };
      this.writableWaiters.push(waiter);
      if (signal !== undefined && abortHandler !== undefined) signal.addEventListener("abort", abortHandler, { once: true });
      this.notifyWritableWaiters();
    });
  }

  public async close(reason: TransportCloseReason = { code: "normal" }, options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {}): Promise<void> {
    abortIfSignalled(options.signal);
    if (this.currentState === "closed" || this.currentState === "failed") return;
    if (this.closePromise !== undefined) return this.closePromise;
    this.closeReason = reason;
    this.setState("closing", reason);
    const timeoutMs = options.timeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) throw new RangeError("timeoutMs must be a non-negative integer");

    this.closePromise = (async () => {
      const startedAt = Date.now();
      while (this.outboundBytes > 0 && Date.now() - startedAt < timeoutMs) {
        abortIfSignalled(options.signal);
        await new Promise<void>((resolve) => setTimeout(resolve, Math.min(10, Math.max(1, timeoutMs))));
      }
      if (this.outboundBytes > 0) this.rejectOutbound(new Error("transport close timed out"));
      this.finishClosed(reason);
      this.peer?.peerClosed(reason);
    })();
    return this.closePromise;
  }

  public onStateChange(listener: (state: TransportState, reason?: TransportCloseReason) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /** Force a failed lifecycle state for fault-injection tests. */
  public fail(reason: TransportCloseReason = { code: "internal", message: "scripted transport failure" }): void {
    if (this.currentState === "closed" || this.currentState === "failed") return;
    this.rejectOutbound(reason.cause ?? new Error(reason.message ?? "transport failed"));
    this.finishIncoming(reason.cause ?? new Error(reason.message ?? "transport failed"));
    this.setState("failed", reason);
    this.peer?.peerClosed(reason);
  }

  /** Internal hook used by the paired endpoint when its inbound queue drains. */
  private onInboundDrain(listener: () => void): () => void {
    this.inboundDrainListeners.add(listener);
    return () => this.inboundDrainListeners.delete(listener);
  }

  private nextIncoming(): Promise<IteratorResult<Uint8Array>> {
    if (this.inbound.length > 0) {
      const frame = this.inbound.shift() as Uint8Array;
      this.inboundBytes -= frame.byteLength;
      this.notifyInboundDrain();
      return Promise.resolve({ done: false, value: frame });
    }
    if (this.inboundEnded) {
      if (this.inboundFailure !== undefined) return Promise.reject(this.inboundFailure);
      return Promise.resolve({ done: true, value: undefined } as IteratorResult<Uint8Array>);
    }
    return new Promise<IteratorResult<Uint8Array>>((resolve, reject) => this.incomingWaiters.push({ resolve, reject }));
  }

  private cancelIncomingIterator(): void {
    this.finishIncoming();
  }

  private enqueueInbound(frame: Uint8Array): boolean {
    if (this.inboundEnded || this.currentState === "closed" || this.currentState === "failed") return false;
    if (this.inboundBytes + frame.byteLength > this.capacity) return false;
    const waiter = this.incomingWaiters.shift();
    if (waiter !== undefined) {
      waiter.resolve({ done: false, value: frame });
    } else {
      this.inbound.push(frame);
      this.inboundBytes += frame.byteLength;
    }
    return true;
  }

  private schedulePump(): void {
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    const run = () => {
      this.pumpScheduled = false;
      this.pump();
    };
    if (this.deliveryDelayMs > 0) setTimeout(run, this.deliveryDelayMs);
    else queueMicrotask(run);
  }

  private pump(): void {
    const peer = this.peer;
    if (peer === undefined || this.outbound.length === 0 || this.currentState === "failed" || this.currentState === "closed") return;
    if (peer.currentState !== "open") {
      if (peer.currentState === "closed" || peer.currentState === "failed") this.peerClosed(peer.closeReason);
      return;
    }
    const next = this.outbound[0] as PendingFrame;
    if (!peer.enqueueInbound(next.frame)) {
      peer.onInboundDrain(() => this.schedulePump());
      return;
    }
    this.outbound.shift();
    this.outboundBytes -= next.frame.byteLength;
    this.notifyWritableWaiters();
    this.schedulePump();
    if (this.currentState === "closing" && this.outboundBytes === 0) this.finishClosed(this.closeReason ?? { code: "normal" });
  }

  private notifyWritableWaiters(): void {
    for (const waiter of [...this.writableWaiters]) {
      if (this.outboundBytes + waiter.requiredBytes <= this.capacity) {
        this.removeWritableWaiter(waiter);
        if (waiter.signal !== undefined && waiter.abortHandler !== undefined) waiter.signal.removeEventListener("abort", waiter.abortHandler);
        waiter.resolve();
      }
    }
  }

  private removeWritableWaiter(waiter: SendWaiter): void {
    const index = this.writableWaiters.indexOf(waiter);
    if (index >= 0) this.writableWaiters.splice(index, 1);
  }

  private notifyInboundDrain(): void {
    for (const listener of [...this.inboundDrainListeners]) listener();
    this.inboundDrainListeners.clear();
  }

  private finishClosed(reason: TransportCloseReason): void {
    if (this.currentState === "closed" || this.currentState === "failed") return;
    this.finishIncoming();
    this.setState("closed", reason);
  }

  private peerClosed(reason: TransportCloseReason | undefined): void {
    this.closeReason = reason;
    this.rejectOutbound(reason?.cause ?? new Error(reason?.message ?? "peer closed transport"));
    const failure = reason === undefined || reason.code === "normal" ? undefined : reason.cause ?? new Error(reason.message ?? "peer closed transport");
    this.finishIncoming(failure);
    if (this.currentState !== "closed" && this.currentState !== "failed") this.setState("closed", reason);
  }

  private rejectOutbound(error: unknown): void {
    while (this.outbound.length > 0) {
      const pending = this.outbound.shift() as PendingFrame;
      this.outboundBytes -= pending.frame.byteLength;
      pending.reject(error);
    }
    for (const waiter of this.writableWaiters.splice(0)) {
      if (waiter.signal !== undefined && waiter.abortHandler !== undefined) waiter.signal.removeEventListener("abort", waiter.abortHandler);
      waiter.reject(error);
    }
  }

  private finishIncoming(error?: unknown): void {
    if (this.inboundEnded) return;
    this.inboundEnded = true;
    this.inboundFailure = error;
    for (const waiter of this.incomingWaiters.splice(0)) {
      if (error === undefined) waiter.resolve({ done: true, value: undefined } as IteratorResult<Uint8Array>);
      else waiter.reject(error);
    }
    this.notifyInboundDrain();
  }

  private setState(state: TransportState, reason?: TransportCloseReason): void {
    this.currentState = state;
    for (const listener of [...this.stateListeners]) listener(state, reason);
  }
}

export interface InMemoryTransportPair {
  readonly left: InMemoryTransport;
  readonly right: InMemoryTransport;
  /** Aliases make fixtures read naturally as client/server or A/B. */
  readonly a: InMemoryTransport;
  readonly b: InMemoryTransport;
  readonly client: InMemoryTransport;
  readonly server: InMemoryTransport;
  readonly open: (signal?: AbortSignal) => Promise<void>;
}

export function createInMemoryTransportPair(options: InMemoryTransportPairOptions = {}): InMemoryTransportPair {
  const left = new InMemoryTransport({
    ...(options.leftCapacityBytes ?? options.capacityBytes) === undefined ? {} : { capacityBytes: options.leftCapacityBytes ?? options.capacityBytes },
    ...(options.leftMaxFrameBytes ?? options.maxFrameBytes) === undefined ? {} : { maxFrameBytes: options.leftMaxFrameBytes ?? options.maxFrameBytes },
    ...(options.leftDeliveryDelayMs ?? options.deliveryDelayMs) === undefined ? {} : { deliveryDelayMs: options.leftDeliveryDelayMs ?? options.deliveryDelayMs },
  });
  const right = new InMemoryTransport({
    ...(options.rightCapacityBytes ?? options.capacityBytes) === undefined ? {} : { capacityBytes: options.rightCapacityBytes ?? options.capacityBytes },
    ...(options.rightMaxFrameBytes ?? options.maxFrameBytes) === undefined ? {} : { maxFrameBytes: options.rightMaxFrameBytes ?? options.maxFrameBytes },
    ...(options.rightDeliveryDelayMs ?? options.deliveryDelayMs) === undefined ? {} : { deliveryDelayMs: options.rightDeliveryDelayMs ?? options.deliveryDelayMs },
  });
  left.connect(right);
  const open = async (signal?: AbortSignal): Promise<void> => {
    await Promise.all([left.open(signal), right.open(signal)]);
  };
  const pair: InMemoryTransportPair = { left, right, a: left, b: right, client: left, server: right, open };
  if (options.autoOpen === true) void open();
  return pair;
}
