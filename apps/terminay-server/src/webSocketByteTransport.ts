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
	private terminalReason: TransportCloseReason | undefined;

	constructor(
		private readonly socket: WebSocket,
		private readonly maxFrameBytes = DEFAULT_PROTOCOL_LIMITS.maxFrameBytes,
		private readonly maxQueuedBytes = DEFAULT_PROTOCOL_LIMITS.maxQueuedBytes,
	) {
		if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes <= 0)
			throw new RangeError('remote stream frame limit is invalid');
		if (!Number.isSafeInteger(maxQueuedBytes) || maxQueuedBytes < maxFrameBytes)
			throw new RangeError('remote stream queue limit is invalid');
		this.socket.on('message', (data) => this.receive(data));
		this.socket.once('close', (code, reason) =>
			this.finishClosed(
				this.terminalReason ?? socketCloseReason(code, reason),
			),
		);
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
		try { return this.readBufferedAmount(); } catch { return 0; }
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
		await this.waitForWritable(frame.byteLength, options.signal);
		this.assertWritable();
		await new Promise<void>((resolve, reject) => {
			try {
				this.socket.send(frame, { binary: true }, (error) => {
					if (error) {
						this.fail({ code: 'unavailable', message: 'remote stream send failed', cause: error });
						reject(error);
					} else resolve();
				});
			} catch (cause) {
				this.fail({ code: 'unavailable', message: 'remote stream send failed', cause });
				reject(cause);
			}
		});
	}

	async waitForWritable(requiredBytes = 1, signal?: AbortSignal): Promise<void> {
		if (signal?.aborted) throw signal.reason;
		if (!Number.isSafeInteger(requiredBytes) || requiredBytes < 1 || requiredBytes > this.maxQueuedBytes)
			throw new RangeError('remote stream writable size is invalid');
		while (this.readBufferedAmount() + requiredBytes > this.maxQueuedBytes) {
			this.assertWritable();
			await abortableDelay(signal);
		}
		this.assertWritable();
	}

	async close(reason: TransportCloseReason = { code: 'normal' }): Promise<void> {
		if (this.stateValue === 'closed' || this.stateValue === 'failed') return;
		this.terminalReason = reason;
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
		this.terminalReason = reason;
		this.finishIncoming();
		this.transition('failed', reason);
		try { this.socket.close(closeCode(reason), reason.message?.slice(0, 120)); } catch { /* best effort after failure */ }
	}

	private finishClosed(reason: TransportCloseReason): void {
		if (this.stateValue === 'closed' || this.stateValue === 'failed') return;
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
		for (const listener of [...this.listeners]) {
			try { listener(state, reason); } catch { /* State observers cannot break transport lifecycle. */ }
		}
	}

	private assertWritable(): void {
		if (this.stateValue === 'open' && this.socket.readyState === WebSocket.OPEN) return;
		if (this.stateValue === 'open') {
			this.fail({ code: 'unavailable', message: 'remote stream underlying socket is not open' });
		}
		throw new Error(`remote stream is ${this.stateValue}`);
	}

	private readBufferedAmount(): number {
		const value = this.socket.bufferedAmount;
		if (!Number.isSafeInteger(value) || value < 0 || value > this.maxQueuedBytes * 2) {
			this.fail({ code: 'resource', message: 'remote stream buffered amount is invalid' });
			throw new Error('remote stream buffered amount is invalid');
		}
		return value;
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

function socketCloseReason(code: number, reason: Buffer): TransportCloseReason {
	const message = reason.toString('utf8').slice(0, 120);
	return {
		code: code === 1000 ? 'normal' : 'unavailable',
		...(message === '' ? {} : { message }),
	};
}

async function abortableDelay(signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) throw signal.reason;
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(done, 5);
		function done(): void {
			signal?.removeEventListener('abort', abort);
			resolve();
		}
		function abort(): void {
			clearTimeout(timer);
			signal?.removeEventListener('abort', abort);
			reject(signal?.reason);
		}
		signal?.addEventListener('abort', abort, { once: true });
	});
}
