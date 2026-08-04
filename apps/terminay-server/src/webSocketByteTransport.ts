import { WebSocket, type RawData } from 'ws';
import {
	type ByteTransport,
	DEFAULT_PROTOCOL_LIMITS,
	type TransportCloseReason,
	type TransportSendOptions,
	type TransportState,
	validateTransportFrame,
} from '@terminay/protocol';

export class ServerWebSocketByteTransport implements ByteTransport {
	private readonly values: Uint8Array[] = [];
	private readonly waiters: Array<(result: IteratorResult<Uint8Array>) => void> =
		[];
	private readonly listeners = new Set<
		(state: TransportState, reason?: TransportCloseReason) => void
	>();
	private stateValue: TransportState = 'opening';
	private buffered = 0;

	constructor(
		private readonly socket: WebSocket,
		private readonly maxFrameBytes = DEFAULT_PROTOCOL_LIMITS.maxFrameBytes,
	) {
		this.socket.on('message', (data) => this.receive(data));
		this.socket.once('close', () => this.finishClosed({ code: 'normal' }));
		this.socket.once('error', (cause) =>
			this.fail({ code: 'unavailable', message: 'remote stream failed', cause }),
		);
	}

	get state(): TransportState {
		return this.stateValue;
	}
	get incoming(): AsyncIterable<Uint8Array> {
		return {
			[Symbol.asyncIterator]: () => ({ next: () => this.next() }),
		};
	}
	get queuedBytes(): number {
		return this.socket.bufferedAmount;
	}
	get bufferedBytes(): number {
		return this.buffered;
	}

	async open(signal?: AbortSignal): Promise<void> {
		if (signal?.aborted) throw signal.reason;
		if (this.stateValue === 'open') return;
		if (this.stateValue !== 'opening')
			throw new Error(`remote stream is ${this.stateValue}`);
		if (this.socket.readyState !== WebSocket.OPEN)
			throw new Error('remote stream is not open');
		this.transition('open');
	}

	async send(
		frame: Uint8Array,
		options: TransportSendOptions = {},
	): Promise<void> {
		if (options.signal?.aborted) throw options.signal.reason;
		validateTransportFrame(frame, this.maxFrameBytes);
		if (
			this.stateValue !== 'open' ||
			this.socket.readyState !== WebSocket.OPEN
		)
			throw new Error(`remote stream is ${this.stateValue}`);
		await new Promise<void>((resolve, reject) => {
			this.socket.send(frame, { binary: true }, (error) => {
				if (error) reject(error);
				else resolve();
			});
		});
	}

	async waitForWritable(_requiredBytes = 0, signal?: AbortSignal): Promise<void> {
		if (signal?.aborted) throw signal.reason;
		if (this.stateValue !== 'open')
			throw new Error(`remote stream is ${this.stateValue}`);
	}

	async close(reason: TransportCloseReason = { code: 'normal' }): Promise<void> {
		if (this.stateValue === 'closed') return;
		this.transition('closing', reason);
		if (
			this.socket.readyState === WebSocket.OPEN ||
			this.socket.readyState === WebSocket.CONNECTING
		)
			this.socket.close(closeCode(reason), reason.message?.slice(0, 120));
		this.finishClosed(reason);
	}

	onStateChange(
		listener: (state: TransportState, reason?: TransportCloseReason) => void,
	): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private receive(data: RawData): void {
		try {
			const frame = rawDataBytes(data);
			validateTransportFrame(frame, this.maxFrameBytes);
			this.push(frame);
		} catch (cause) {
			void this.close({
				code: 'protocol_error',
				message: 'remote stream sent invalid binary data',
				cause,
			});
		}
	}

	private next(): Promise<IteratorResult<Uint8Array>> {
		const value = this.values.shift();
		if (value !== undefined) {
			this.buffered -= value.byteLength;
			return Promise.resolve({ done: false, value });
		}
		if (this.stateValue === 'closed' || this.stateValue === 'failed')
			return Promise.resolve({ done: true, value: undefined });
		return new Promise((resolve) => this.waiters.push(resolve));
	}

	private push(value: Uint8Array): void {
		const copy = value.slice();
		const waiter = this.waiters.shift();
		if (waiter !== undefined) {
			waiter({ done: false, value: copy });
			return;
		}
		this.values.push(copy);
		this.buffered += copy.byteLength;
	}

	private fail(reason: TransportCloseReason): void {
		if (this.stateValue === 'closed' || this.stateValue === 'failed') return;
		this.finishIncoming();
		this.transition('failed', reason);
	}

	private finishClosed(reason: TransportCloseReason): void {
		if (this.stateValue === 'closed') return;
		this.finishIncoming();
		this.transition('closed', reason);
	}

	private finishIncoming(): void {
		this.values.length = 0;
		this.buffered = 0;
		while (this.waiters.length > 0)
			this.waiters.shift()?.({ done: true, value: undefined });
	}

	private transition(state: TransportState, reason?: TransportCloseReason): void {
		this.stateValue = state;
		for (const listener of this.listeners) listener(state, reason);
	}
}

function rawDataBytes(data: RawData): Uint8Array {
	if (Array.isArray(data)) return Buffer.concat(data).slice();
	if (data instanceof ArrayBuffer) return new Uint8Array(data);
	if (ArrayBuffer.isView(data))
		return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
	throw new TypeError('remote stream message is not binary');
}

function closeCode(reason: TransportCloseReason): number {
	if (reason.code === 'unauthorized') return 1008;
	if (reason.code === 'protocol_error') return 1002;
	if (reason.code === 'unavailable') return 1013;
	return 1000;
}
