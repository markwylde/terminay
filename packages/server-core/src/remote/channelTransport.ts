import {
	abortIfSignalled,
	DEFAULT_PROTOCOL_LIMITS,
	validateTransportFrame,
	type ByteTransport,
	type TransportCloseReason,
	type TransportState,
} from "@terminay/protocol";
import type { HeadlessDataChannel, HeadlessDataChannelState } from "./headless.js";

const DEFAULT_BUFFERED_BYTES = DEFAULT_PROTOCOL_LIMITS.maxQueuedBytes;
const DEFAULT_CLOSE_TIMEOUT_MS = 1_000;
const DEFAULT_MAX_WRITABLE_WAIT_MS = 30_000;

export interface HeadlessChannelTransportOptions {
	readonly maxFrameBytes?: number;
	readonly maxBufferedBytes?: number;
	readonly maxInboundBytes?: number;
	/** Maximum time a send may wait for channel backpressure to drain. */
	readonly maxWritableWaitMs?: number;
}

type IncomingWaiter = {
	readonly resolve: (result: IteratorResult<Uint8Array>) => void;
	readonly reject: (reason?: unknown) => void;
};

/**
 * Adapt one already-authenticated server-owned data channel to the canonical
 * ByteTransport contract. Each traffic class gets its own instance, so asset
 * pressure cannot consume the control/application queue.
 */
export class HeadlessChannelTransport implements ByteTransport {
	private currentState: TransportState = "opening";
	private readonly maxFrameBytes: number;
	private readonly maxBufferedBytes: number;
	private readonly maxInboundBytes: number;
	private readonly maxWritableWaitMs: number;
	private readonly inbound: Uint8Array[] = [];
	private inboundBytes = 0;
	private inboundEnded = false;
	private inboundFailure: unknown;
	private readonly incomingWaiters: IncomingWaiter[] = [];
	private readonly stateListeners = new Set<(state: TransportState, reason?: TransportCloseReason) => void>();
	private readonly removeListeners: Array<() => void> = [];
	private closePromise: Promise<void> | undefined;
	private closeReason: TransportCloseReason | undefined;

	constructor(
		private readonly channel: HeadlessDataChannel,
		options: HeadlessChannelTransportOptions = {},
		subscribe: (listener: (frame: Uint8Array) => void) => () => void = (listener) => channel.onMessage(listener),
	) {
		this.maxFrameBytes = positive(options.maxFrameBytes ?? DEFAULT_PROTOCOL_LIMITS.maxFrameBytes, "maxFrameBytes");
		this.maxBufferedBytes = positive(options.maxBufferedBytes ?? DEFAULT_BUFFERED_BYTES, "maxBufferedBytes");
		this.maxInboundBytes = positive(options.maxInboundBytes ?? this.maxBufferedBytes, "maxInboundBytes");
		this.maxWritableWaitMs = positive(options.maxWritableWaitMs ?? DEFAULT_MAX_WRITABLE_WAIT_MS, "maxWritableWaitMs");
		this.removeListeners.push(subscribe((frame) => this.enqueueIncoming(frame)));
		this.removeListeners.push(channel.onStateChange((state) => this.onChannelState(state)));
		this.onChannelState(channel.readyState);
	}

	get state(): TransportState {
		return this.currentState;
	}

	get incoming(): AsyncIterable<Uint8Array> {
		const endpoint = this;
		return {
			[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
				return {
					next: () => endpoint.nextIncoming(),
					return: async () => {
						endpoint.finishIncoming();
						return { done: true, value: undefined } as IteratorResult<Uint8Array>;
					},
				};
			},
		};
	}

	get queuedBytes(): number {
		if (this.currentState === "closed" || this.currentState === "failed") return 0;
		// Native channel counters are an untrusted boundary.  This getter is used
		// by diagnostics as well as flow-control, so an invalid native value must
		// not escape as poisoned relay state or leave the authenticated transport
		// live.  Keep the read API total after failing closed; send/wait callers
		// receive the concrete failure from readBufferedAmount below.
		try {
			return this.readBufferedAmount();
		} catch {
			return 0;
		}
	}

	get bufferedBytes(): number {
		return this.inboundBytes;
	}

	async open(signal?: AbortSignal): Promise<void> {
		abortIfSignalled(signal);
		if (this.currentState === "open") return;
		if (this.currentState === "closed" || this.currentState === "failed") throw transportError(this.currentState);
		await new Promise<void>((resolve, reject) => {
			let done = false;
			let remove = (): void => undefined;
			const finish = (error?: unknown): void => {
				if (done) return;
				done = true;
				remove();
				if (signal !== undefined) signal.removeEventListener("abort", onAbort);
				if (error === undefined) resolve();
				else reject(error);
			};
			const onAbort = (): void => finish(signal?.reason ?? new DOMException("The operation was aborted", "AbortError"));
			remove = this.onStateChange((state) => {
				if (state === "open") finish();
				else if (state === "closed" || state === "failed") finish(transportError(state));
			});
			if (signal !== undefined) signal.addEventListener("abort", onAbort, { once: true });
			if (this.currentState === "open") finish();
		});
	}

	async send(frame: Uint8Array, options: { readonly signal?: AbortSignal } = {}): Promise<void> {
		abortIfSignalled(options.signal);
		validateTransportFrame(frame, this.maxFrameBytes);
		await this.waitForWritable(frame.byteLength, options.signal);
		if (this.currentState !== "open") throw transportError(this.currentState);
		try {
			this.channel.send(frame.slice());
		} catch (error) {
			this.fail({ code: "unavailable", message: "headless data channel send failed", cause: error });
			throw error;
		}
	}

	async waitForWritable(requiredBytes = 1, signal?: AbortSignal): Promise<void> {
		abortIfSignalled(signal);
		if (!Number.isSafeInteger(requiredBytes) || requiredBytes <= 0 || requiredBytes > this.maxBufferedBytes) throw new RangeError("transport writable size is invalid");
		const deadline = Date.now() + this.maxWritableWaitMs;
		while (true) {
			if (this.currentState !== "open") throw transportError(this.currentState);
			const buffered = this.readBufferedAmount();
			if (buffered + requiredBytes <= this.maxBufferedBytes) return;
			const remaining = deadline - Date.now();
			if (remaining <= 0) {
				const error = new Error("headless data channel remained backpressured");
				this.fail({ code: "timeout", message: error.message, cause: error });
				throw error;
			}
			await delay(Math.min(10, remaining), signal);
		}
	}

	async close(reason: TransportCloseReason = { code: "normal" }, options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {}): Promise<void> {
		abortIfSignalled(options.signal);
		if (this.currentState === "closed" || this.currentState === "failed") return;
		if (this.closePromise !== undefined) return this.closePromise;
		this.closeReason = reason;
		this.setState("closing", reason);
		const timeoutMs = options.timeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
		if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) throw new RangeError("timeoutMs must be a non-negative integer");
		this.closePromise = (async () => {
			this.removeChannelListeners();
			try {
				this.channel.close();
			} finally {
				this.finishIncoming();
				this.setState("closed", this.closeReason);
			}
			void timeoutMs;
		})();
		return this.closePromise;
	}

	onStateChange(listener: (state: TransportState, reason?: TransportCloseReason) => void): () => void {
		this.stateListeners.add(listener);
		return () => this.stateListeners.delete(listener);
	}

	private nextIncoming(): Promise<IteratorResult<Uint8Array>> {
		if (this.inbound.length > 0) {
			const frame = this.inbound.shift() as Uint8Array;
			this.inboundBytes -= frame.byteLength;
			return Promise.resolve({ done: false, value: frame });
		}
		if (this.inboundEnded) {
			if (this.inboundFailure !== undefined) return Promise.reject(this.inboundFailure);
			return Promise.resolve({ done: true, value: undefined } as IteratorResult<Uint8Array>);
		}
		return new Promise<IteratorResult<Uint8Array>>((resolve, reject) => this.incomingWaiters.push({ resolve, reject }));
	}

	private enqueueIncoming(frame: Uint8Array): void {
		if (this.inboundEnded || this.currentState === "closed" || this.currentState === "failed") return;
		try {
			validateTransportFrame(frame, this.maxFrameBytes);
		} catch (error) {
			this.fail({ code: "protocol_error", message: "headless data channel frame is invalid", cause: error });
			return;
		}
		if (this.inboundBytes + frame.byteLength > this.maxInboundBytes) {
			this.fail({ code: "resource", message: "headless data channel inbound queue limit reached" });
			return;
		}
		const copy = frame.slice();
		const waiter = this.incomingWaiters.shift();
		if (waiter !== undefined) waiter.resolve({ done: false, value: copy });
		else {
			this.inbound.push(copy);
			this.inboundBytes += copy.byteLength;
		}
	}

	private readBufferedAmount(): number {
		let buffered: number;
		try {
			buffered = this.channel.bufferedAmount;
		} catch (cause) {
			this.fail({ code: "resource", message: "headless data channel buffered amount is invalid", cause });
			throw new Error("headless data channel buffered amount is invalid", { cause });
		}
		if (!Number.isSafeInteger(buffered) || buffered < 0 || buffered > this.maxBufferedBytes * 2) {
			this.fail({ code: "resource", message: "headless data channel buffered amount is invalid" });
			throw new Error("headless data channel buffered amount is invalid");
		}
		return buffered;
	}

	private onChannelState(state: HeadlessDataChannelState): void {
		if (state === "open") {
			if (this.currentState === "opening") this.setState("open");
			return;
		}
		if (state === "closing") {
			if (this.currentState === "open" || this.currentState === "opening") this.setState("closing");
			return;
		}
		if (state === "closed" && this.currentState !== "failed") {
			// A remote peer can disappear without the transport initiating close.
			// Drop both native subscriptions immediately so repeated reconnects cannot
			// retain one message/state closure per abandoned channel.
			this.removeChannelListeners();
			this.finishIncoming();
			this.setState("closed", this.closeReason);
		}
	}

	private fail(reason: TransportCloseReason): void {
		if (this.currentState === "closed" || this.currentState === "failed") return;
		this.closeReason = reason;
		this.finishIncoming(reason.cause ?? new Error(reason.message ?? "headless data channel failed"));
		this.removeChannelListeners();
		try {
			this.channel.close();
		} catch {
			/* The transport is already failed; native cleanup is best effort. */
		}
		this.setState("failed", reason);
	}

	private finishIncoming(error?: unknown): void {
		if (this.inboundEnded) return;
		this.inboundEnded = true;
		this.inboundFailure = error;
		// A closed/failed authenticated channel must not retain a stalled
		// consumer's queued application frames or expose them to a later iterator.
		this.inbound.splice(0);
		this.inboundBytes = 0;
		for (const waiter of this.incomingWaiters.splice(0)) {
			if (error === undefined) waiter.resolve({ done: true, value: undefined } as IteratorResult<Uint8Array>);
			else waiter.reject(error);
		}
	}

	private removeChannelListeners(): void {
		for (const remove of this.removeListeners.splice(0)) remove();
	}

	private setState(state: TransportState, reason?: TransportCloseReason): void {
		this.currentState = state;
		// State observers are diagnostics/UI consumers, not part of the native
		// channel lifecycle. One faulty observer must not escape through a native
		// state callback or prevent the remaining observers seeing a transition.
		for (const listener of [...this.stateListeners]) {
			try {
				listener(state, reason);
			} catch {
				/* Observer failures cannot change the authenticated transport state. */
			}
		}
	}
}

function positive(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be positive`);
	return value;
}

function transportError(state: TransportState): Error {
	return new Error(`transport is ${state}`);
}

async function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
	abortIfSignalled(signal);
	await new Promise<void>((resolve, reject) => {
		let settled = false;
		const timer = setTimeout(() => {
			settled = true;
			if (signal !== undefined) signal.removeEventListener("abort", onAbort);
			resolve();
		}, milliseconds);
		const onAbort = (): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (signal !== undefined) signal.removeEventListener("abort", onAbort);
			reject(signal?.reason ?? new DOMException("The operation was aborted", "AbortError"));
		};
		if (signal !== undefined) signal.addEventListener("abort", onAbort, { once: true });
	});
}
