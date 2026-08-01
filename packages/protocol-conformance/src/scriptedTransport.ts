import {
  abortIfSignalled,
  type ByteTransport,
  type TransportCloseReason,
  type TransportSendOptions,
  type TransportCloseOptions,
  type TransportState,
} from "@terminay/protocol";
import {
  createInMemoryTransportPair,
  type InMemoryTransportPairOptions,
  type InMemoryTransport,
} from "./inMemoryTransport.js";

export type ScriptedTransportAction = "open" | "send" | "close";
export type ScriptedFaultMode = "throw" | "drop" | "close" | "fail";

export interface ScriptedFault {
  readonly action: ScriptedTransportAction;
  /** One-based invocation number. Omit to apply on the next matching call. */
  readonly occurrence?: number;
  readonly mode?: ScriptedFaultMode;
  readonly message?: string;
  readonly reason?: TransportCloseReason;
}

export interface ScriptedTransportOptions {
  readonly inner?: ByteTransport;
  readonly delayMs?: number;
  readonly sendDelayMs?: number;
  readonly receiveDelayMs?: number;
  readonly faults?: readonly ScriptedFault[];
  /** Drop every Nth send after it has been accepted by this adapter. */
  readonly dropEveryNthSend?: number;
  /** Fail the adapter after this many send calls. */
  readonly failAfterSends?: number;
  /** Close the adapter after this many accepted send calls. */
  readonly closeAfterSends?: number;
}

export interface ScriptedTransportPairOptions extends InMemoryTransportPairOptions {
  readonly left?: Omit<ScriptedTransportOptions, "inner">;
  readonly right?: Omit<ScriptedTransportOptions, "inner">;
}

interface FailureCapableTransport extends ByteTransport {
  fail?: (reason?: TransportCloseReason) => void;
}

function nonNegativeInteger(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 0) throw new RangeError(`${name} must be a non-negative integer`);
  return result;
}

function positiveInteger(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer`);
  return value;
}

function faultError(fault: ScriptedFault): Error {
  return new Error(fault.message ?? `scripted ${fault.action} fault`);
}

function delay(ms: number): Promise<void> {
  if (ms === 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A transport decorator used to make slow-consumer, loss, and lifecycle
 * failures reproducible. It delegates all byte/lifecycle semantics to the
 * supplied transport and therefore remains useful for real transport pairs.
 */
export class ScriptedTransport implements ByteTransport {
  private readonly inner: FailureCapableTransport;
  private readonly sendDelayMs: number;
  private readonly receiveDelayMs: number;
  private readonly faults: readonly ScriptedFault[];
  private readonly dropEveryNthSend: number | undefined;
  private readonly failAfterSends: number | undefined;
  private readonly closeAfterSends: number | undefined;
  private readonly calls = new Map<ScriptedTransportAction, number>();
  private sendCount = 0;

  public constructor(options: ScriptedTransportOptions = {}) {
    if (options.inner === undefined) throw new TypeError("ScriptedTransport requires an inner ByteTransport");
    this.inner = options.inner as FailureCapableTransport;
    const sharedDelay = nonNegativeInteger(options.delayMs, 0, "delayMs");
    this.sendDelayMs = nonNegativeInteger(options.sendDelayMs, sharedDelay, "sendDelayMs");
    this.receiveDelayMs = nonNegativeInteger(options.receiveDelayMs, sharedDelay, "receiveDelayMs");
    this.faults = options.faults ?? [];
    this.dropEveryNthSend = positiveInteger(options.dropEveryNthSend, "dropEveryNthSend");
    this.failAfterSends = positiveInteger(options.failAfterSends, "failAfterSends");
    this.closeAfterSends = positiveInteger(options.closeAfterSends, "closeAfterSends");
  }

  public get state(): TransportState {
    return this.inner.state;
  }

  public get incoming(): AsyncIterable<Uint8Array> {
    return this.delayedIncoming();
  }

  public get queuedBytes(): number {
    return this.inner.queuedBytes;
  }

  public get bufferedBytes(): number {
    return this.inner.bufferedBytes;
  }

  public async open(signal?: AbortSignal): Promise<void> {
    abortIfSignalled(signal);
    const fault = this.nextFault("open");
    if (fault !== undefined) {
      await this.applyFault(fault);
      if (fault.mode !== "drop") return;
    }
    await this.inner.open(signal);
  }

  public async send(frame: Uint8Array, options: TransportSendOptions = {}): Promise<void> {
    abortIfSignalled(options.signal);
    this.sendCount += 1;
    const fault = this.nextFault("send");
    if (fault !== undefined) {
      await this.applyFault(fault);
      if (fault.mode === "throw" || fault.mode === "fail" || fault.mode === "close") return;
      if (fault.mode === "drop") return;
    }
    if (this.dropEveryNthSend !== undefined && this.sendCount % this.dropEveryNthSend === 0) return;
    await delay(this.sendDelayMs);
    abortIfSignalled(options.signal);
    await this.inner.send(frame, options);
    if (this.failAfterSends !== undefined && this.sendCount >= this.failAfterSends) {
      this.inner.fail?.({ code: "internal", message: "scripted send threshold reached" });
    } else if (this.closeAfterSends !== undefined && this.sendCount >= this.closeAfterSends) {
      void this.inner.close({ code: "unavailable", message: "scripted send threshold reached" });
    }
  }

  public waitForWritable(requiredBytes = 1, signal?: AbortSignal): Promise<void> {
    return this.inner.waitForWritable(requiredBytes, signal);
  }

  public async close(reason?: TransportCloseReason, options: TransportCloseOptions = {}): Promise<void> {
    const fault = this.nextFault("close");
    if (fault !== undefined) {
      await this.applyFault(fault);
      if (fault.mode === "throw" || fault.mode === "fail" || fault.mode === "close") return;
    }
    await this.inner.close(reason, options);
  }

  public onStateChange(listener: (state: TransportState, reason?: TransportCloseReason) => void): () => void {
    return this.inner.onStateChange(listener);
  }

  public fail(reason: TransportCloseReason = { code: "internal", message: "scripted transport failure" }): void {
    this.inner.fail?.(reason);
    if (this.inner.fail === undefined) void this.inner.close(reason);
  }

  private async *delayedIncoming(): AsyncGenerator<Uint8Array> {
    for await (const frame of this.inner.incoming) {
      await delay(this.receiveDelayMs);
      yield frame;
    }
  }

  private nextFault(action: ScriptedTransportAction): ScriptedFault | undefined {
    const count = (this.calls.get(action) ?? 0) + 1;
    this.calls.set(action, count);
    return this.faults.find((fault) => fault.action === action && (fault.occurrence === undefined || fault.occurrence === count));
  }

  private async applyFault(fault: ScriptedFault): Promise<void> {
    const mode = fault.mode ?? "throw";
    if (mode === "throw") throw faultError(fault);
    const reason = fault.reason ?? { code: "unavailable", message: fault.message ?? "scripted transport fault" };
    if (mode === "fail") {
      this.fail(reason);
      return;
    }
    if (mode === "close") {
      await this.inner.close(reason);
    }
  }
}

export interface ScriptedTransportPair {
  readonly left: ScriptedTransport;
  readonly right: ScriptedTransport;
  readonly a: ScriptedTransport;
  readonly b: ScriptedTransport;
  readonly client: ScriptedTransport;
  readonly server: ScriptedTransport;
  readonly open: (signal?: AbortSignal) => Promise<void>;
  readonly raw: { readonly left: InMemoryTransport; readonly right: InMemoryTransport };
}

export function createScriptedTransportPair(options: ScriptedTransportPairOptions = {}): ScriptedTransportPair {
  const raw = createInMemoryTransportPair(options);
  const left = new ScriptedTransport({ ...options.left, inner: raw.left });
  const right = new ScriptedTransport({ ...options.right, inner: raw.right });
  const open = async (signal?: AbortSignal): Promise<void> => Promise.all([left.open(signal), right.open(signal)]).then(() => undefined);
  return { left, right, a: left, b: right, client: left, server: right, open, raw: { left: raw.left, right: raw.right } };
}

