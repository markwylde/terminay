import {
	type ByteTransport,
	DEFAULT_PROTOCOL_LIMITS,
	type TransportCloseReason,
	type TransportState,
	validateTransportFrame,
} from '@terminay/protocol';
import type { ServerConnectionLike } from '../../packages/server-core/src/types';

export async function superviseApplicationConnection(
	options: Readonly<{
		connection: Pick<ServerConnectionLike, 'start'>;
		isCurrent: () => boolean;
		onRejected: (error: unknown) => void;
		onTerminal: () => void;
	}>,
): Promise<void> {
	let rejected = false;
	let rejection: unknown;
	try {
		await options.connection.start();
	} catch (error) {
		rejected = true;
		rejection = error;
	}
	if (!options.isCurrent()) return;
	try {
		if (rejected) options.onRejected(rejection);
	} finally {
		options.onTerminal();
	}
}

export function createRtcDataChannelTransport(
	channel: RTCDataChannel,
): ByteTransport {
	return new RtcDataChannelTransport(channel);
}

type IncomingWaiter = Readonly<{
	resolve: (result: IteratorResult<Uint8Array>) => void;
	reject: (reason?: unknown) => void;
}>;

class RtcDataChannelTransport implements ByteTransport {
	private currentState: TransportState;
	private readonly inbound: Uint8Array[] = [];
	private readonly waiters: IncomingWaiter[] = [];
	private readonly listeners = new Set<
		(state: TransportState, reason?: TransportCloseReason) => void
	>();

	constructor(private readonly channel: RTCDataChannel) {
		this.currentState =
			channel.readyState === 'open'
				? 'open'
				: channel.readyState === 'connecting'
					? 'opening'
					: 'closed';
		channel.binaryType = 'arraybuffer';
		channel.addEventListener('open', () => this.setState('open'));
		channel.addEventListener('message', (event) => this.receive(event.data));
		channel.addEventListener('close', () =>
			this.finish({
				code: 'unavailable',
				message: 'WebRTC application channel closed.',
			}),
		);
		channel.addEventListener('error', () =>
			this.finish(
				{ code: 'unavailable', message: 'WebRTC application channel failed.' },
				true,
			),
		);
	}

	get state(): TransportState {
		return this.currentState;
	}
	get queuedBytes(): number {
		try {
			return this.readBufferedAmount();
		} catch {
			return 0;
		}
	}
	get bufferedBytes(): number {
		return this.inbound.reduce((total, frame) => total + frame.byteLength, 0);
	}
	get incoming(): AsyncIterable<Uint8Array> {
		return { [Symbol.asyncIterator]: () => ({ next: () => this.next() }) };
	}

	async open(signal?: AbortSignal): Promise<void> {
		if (signal?.aborted) throw signal.reason;
		while (this.currentState === 'opening') {
			if (
				this.channel.readyState === 'closing' ||
				this.channel.readyState === 'closed'
			) {
				this.finish(
					{
						code: 'unavailable',
						message: 'WebRTC application channel closed before opening.',
					},
					true,
				);
				break;
			}
			await rtcAbortableDelay(signal);
		}
		if (this.currentState !== 'open')
			throw new Error('WebRTC application transport is closed.');
	}

	async send(
		frame: Uint8Array,
		options: { readonly signal?: AbortSignal } = {},
	): Promise<void> {
		if (options.signal?.aborted) throw options.signal.reason;
		validateTransportFrame(frame, DEFAULT_PROTOCOL_LIMITS.maxFrameBytes);
		await this.waitForWritable(frame.byteLength, options.signal);
		this.assertWritable();
		try {
			this.channel.send(frame.slice());
		} catch (cause) {
			this.finish(
				{
					code: 'unavailable',
					message: 'WebRTC application send failed.',
					cause,
				},
				true,
			);
			throw cause;
		}
	}

	async waitForWritable(
		requiredBytes = 1,
		signal?: AbortSignal,
	): Promise<void> {
		if (
			!Number.isSafeInteger(requiredBytes) ||
			requiredBytes < 1 ||
			requiredBytes > DEFAULT_PROTOCOL_LIMITS.maxQueuedBytes
		) {
			throw new RangeError('WebRTC writable size is invalid.');
		}
		while (
			this.readBufferedAmount() + requiredBytes >
			DEFAULT_PROTOCOL_LIMITS.maxQueuedBytes
		) {
			this.assertWritable();
			await rtcAbortableDelay(signal);
		}
		if (signal?.aborted) throw signal.reason;
		this.assertWritable();
	}

	async close(
		reason: TransportCloseReason = { code: 'normal' },
	): Promise<void> {
		if (this.currentState === 'closed' || this.currentState === 'failed')
			return;
		this.setState('closing', reason);
		this.channel.close();
		this.finish(reason);
	}

	onStateChange(
		listener: (state: TransportState, reason?: TransportCloseReason) => void,
	): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private receive(value: unknown): void {
		const frame =
			value instanceof ArrayBuffer
				? new Uint8Array(value)
				: ArrayBuffer.isView(value)
					? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
					: undefined;
		if (frame === undefined) {
			this.finish(
				{
					code: 'protocol_error',
					message: 'WebRTC application frame must be binary.',
				},
				true,
			);
			return;
		}
		try {
			validateTransportFrame(frame, DEFAULT_PROTOCOL_LIMITS.maxFrameBytes);
		} catch {
			this.finish(
				{
					code: 'protocol_error',
					message: 'WebRTC application frame is invalid.',
				},
				true,
			);
			return;
		}
		const waiter = this.waiters.shift();
		if (waiter) waiter.resolve({ done: false, value: frame.slice() });
		else this.inbound.push(frame.slice());
	}

	private next(): Promise<IteratorResult<Uint8Array>> {
		const frame = this.inbound.shift();
		if (frame) return Promise.resolve({ done: false, value: frame });
		if (this.currentState === 'closed')
			return Promise.resolve({ done: true, value: undefined });
		if (this.currentState === 'failed')
			return Promise.reject(new Error('WebRTC application transport failed.'));
		return new Promise((resolve, reject) =>
			this.waiters.push({ resolve, reject }),
		);
	}

	private finish(reason: TransportCloseReason, failed = false): void {
		if (this.currentState === 'closed' || this.currentState === 'failed')
			return;
		this.setState(failed ? 'failed' : 'closed', reason);
		this.inbound.splice(0);
		if (this.channel.readyState !== 'closed') {
			try {
				this.channel.close();
			} catch {
				/* Best effort after terminal failure. */
			}
		}
		for (const waiter of this.waiters.splice(0)) {
			if (failed)
				waiter.reject(
					new Error(reason.message ?? 'WebRTC application transport failed.'),
				);
			else waiter.resolve({ done: true, value: undefined });
		}
	}

	private setState(state: TransportState, reason?: TransportCloseReason): void {
		this.currentState = state;
		for (const listener of [...this.listeners]) {
			try {
				listener(state, reason);
			} catch {
				/* Observers cannot break transport lifecycle. */
			}
		}
	}

	private assertWritable(): void {
		if (this.currentState === 'open' && this.channel.readyState === 'open')
			return;
		if (this.currentState === 'open')
			this.finish(
				{
					code: 'unavailable',
					message: 'WebRTC application channel is not open.',
				},
				true,
			);
		throw new Error('WebRTC application transport is closed.');
	}

	private readBufferedAmount(): number {
		const value = this.channel.bufferedAmount;
		if (
			!Number.isSafeInteger(value) ||
			value < 0 ||
			value > DEFAULT_PROTOCOL_LIMITS.maxQueuedBytes * 2
		) {
			this.finish(
				{
					code: 'resource',
					message: 'WebRTC application buffered amount is invalid.',
				},
				true,
			);
			throw new Error('WebRTC application buffered amount is invalid.');
		}
		return value;
	}
}

async function rtcAbortableDelay(signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) throw signal.reason;
	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(done, 5);
		const abort = () => {
			clearTimeout(timeout);
			signal?.removeEventListener('abort', abort);
			reject(signal?.reason);
		};
		function done(): void {
			signal?.removeEventListener('abort', abort);
			resolve();
		}
		signal?.addEventListener('abort', abort, { once: true });
	});
}
