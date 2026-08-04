import {
	abortIfSignalled,
	type ByteTransport,
	DEFAULT_PROTOCOL_LIMITS,
	type TransportCloseOptions,
	type TransportCloseReason,
	type TransportSendOptions,
	type TransportState,
	validateTransportFrame,
} from '@terminay/protocol';

type WebSocketLike = {
	readonly readyState: number;
	readonly bufferedAmount: number;
	binaryType?: string;
	send(data: Uint8Array, callback?: (error?: Error | null) => void): void;
	close(code?: number, reason?: string): void;
	addEventListener?: (
		type: string,
		listener: (event: WebSocketEvent) => void,
		options?: { once?: boolean },
	) => void;
	removeEventListener?: (
		type: string,
		listener: (event: WebSocketEvent) => void,
	) => void;
	on?: (type: string, listener: (...args: unknown[]) => void) => void;
	off?: (type: string, listener: (...args: unknown[]) => void) => void;
};

type WebSocketEvent = {
	readonly data?: unknown;
	readonly error?: unknown;
	readonly code?: number;
	readonly reason?: string;
};

export type WebSocketConstructorLike = new (
	url: string,
	protocols?: readonly string[],
) => WebSocketLike;

export interface WebSocketByteTransportOptions {
	readonly origin: string;
	readonly authToken: string;
	readonly WebSocket?: WebSocketConstructorLike;
	readonly maxFrameBytes?: number;
	readonly path?: string;
}

export class WebSocketByteTransportError extends Error {
	constructor(message: string, options: { readonly cause?: unknown } = {}) {
		super(
			message,
			options.cause === undefined ? undefined : { cause: options.cause },
		);
		this.name = 'WebSocketByteTransportError';
	}
}

export class WebSocketByteTransport implements ByteTransport {
	private readonly url: string;
	private readonly protocols: readonly string[];
	private readonly WebSocketCtor: WebSocketConstructorLike;
	private readonly maxFrameBytes: number;
	private readonly listeners = new Set<
		(state: TransportState, reason?: TransportCloseReason) => void
	>();
	private readonly values: Uint8Array[] = [];
	private readonly waiters: Array<
		(result: IteratorResult<Uint8Array>) => void
	> = [];
	private socket: WebSocketLike | undefined;
	private currentState: TransportState = 'opening';
	private buffered = 0;
	private terminalReason: TransportCloseReason | undefined;

	constructor(options: WebSocketByteTransportOptions) {
		this.url = streamUrl(options.origin, options.path ?? '/protocol/stream');
		this.protocols = Object.freeze([
			'terminay.v1',
			`terminay.auth.${base64UrlEncodeUtf8(options.authToken)}`,
		]);
		const WebSocketCtor =
			options.WebSocket ??
			(globalThis.WebSocket as unknown as WebSocketConstructorLike | undefined);
		if (typeof WebSocketCtor !== 'function')
			throw new TypeError('WebSocket is required for the remote stream transport');
		this.WebSocketCtor = WebSocketCtor;
		this.maxFrameBytes = options.maxFrameBytes ?? DEFAULT_PROTOCOL_LIMITS.maxFrameBytes;
		if (!Number.isSafeInteger(this.maxFrameBytes) || this.maxFrameBytes <= 0)
			throw new RangeError('maxFrameBytes is invalid');
	}

	get state(): TransportState {
		return this.currentState;
	}
	get queuedBytes(): number {
		return this.socket?.bufferedAmount ?? 0;
	}
	get bufferedBytes(): number {
		return this.buffered;
	}
	get incoming(): AsyncIterable<Uint8Array> {
		return {
			[Symbol.asyncIterator]: () => ({ next: () => this.nextIncoming() }),
		};
	}

	async open(signal?: AbortSignal): Promise<void> {
		abortIfSignalled(signal);
		if (this.currentState === 'open') return;
		if (this.currentState !== 'opening')
			throw new WebSocketByteTransportError(
				`remote stream cannot open from ${this.currentState}`,
			);
		const socket = new this.WebSocketCtor(this.url, this.protocols);
		this.socket = socket;
		socket.binaryType = 'arraybuffer';
		await new Promise<void>((resolve, reject) => {
			const cleanup = (): void => {
				removeListener(socket, 'open', onOpen);
				removeListener(socket, 'error', onError);
				removeListener(socket, 'close', onClose);
				signal?.removeEventListener('abort', onAbort);
			};
			const onOpen = (): void => {
				cleanup();
				this.attachSocket(socket);
				this.transition('open');
				resolve();
			};
			const onError = (event: unknown): void => {
				const socketEvent = normalizeWebSocketEvent(event);
				cleanup();
				this.transition('failed', {
					code: 'unavailable',
					message: 'remote stream failed to open',
					cause: socketEvent.error,
				});
				reject(
					new WebSocketByteTransportError('remote stream failed to open', {
						cause: socketEvent.error,
					}),
				);
			};
			const onClose = (event: unknown): void => {
				const socketEvent = normalizeWebSocketEvent(event);
				cleanup();
				this.transition('closed', closeReason(socketEvent));
				reject(
					new WebSocketByteTransportError(
						socketEvent.reason || 'remote stream closed before opening',
					),
				);
			};
			const onAbort = (): void => {
				cleanup();
				try {
					socket.close(1000, 'aborted');
				} catch {
					/* ignored */
				}
				reject(abortError(signal));
			};
			addListener(socket, 'open', onOpen);
			addListener(socket, 'error', onError);
			addListener(socket, 'close', onClose);
			signal?.addEventListener('abort', onAbort, { once: true });
			if (signal?.aborted) onAbort();
		});
	}

	async send(
		frame: Uint8Array,
		options: TransportSendOptions = {},
	): Promise<void> {
		validateTransportFrame(frame, this.maxFrameBytes);
		abortIfSignalled(options.signal);
		const socket = this.socket;
		if (this.currentState !== 'open' || socket === undefined)
			throw new WebSocketByteTransportError(
				`remote stream is ${this.currentState}`,
			);
		await new Promise<void>((resolve, reject) => {
			let settled = false;
			const finish = (error?: Error | null): void => {
				if (settled) return;
				settled = true;
				options.signal?.removeEventListener('abort', abort);
				if (error != null) reject(error);
				else resolve();
			};
			const abort = (): void => finish(abortError(options.signal));
			options.signal?.addEventListener('abort', abort, { once: true });
			if (options.signal?.aborted) {
				abort();
				return;
			}
			try {
				if (socket.send.length >= 2) socket.send(frame, finish);
				else {
					socket.send(frame);
					finish();
				}
			} catch (error) {
				finish(
					error instanceof Error
						? error
						: new WebSocketByteTransportError('remote stream send failed'),
				);
			}
		});
	}

	async waitForWritable(
		requiredBytes = 0,
		signal?: AbortSignal,
	): Promise<void> {
		if (
			requiredBytes < 0 ||
			!Number.isSafeInteger(requiredBytes) ||
			requiredBytes > this.maxFrameBytes
		)
			throw new RangeError('requiredBytes is invalid');
		while ((this.socket?.bufferedAmount ?? 0) > requiredBytes) {
			abortIfSignalled(signal);
			await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
		}
		abortIfSignalled(signal);
		if (this.currentState !== 'open')
			throw new WebSocketByteTransportError(
				`remote stream is ${this.currentState}`,
			);
	}

	async close(
		reason: TransportCloseReason = { code: 'normal' },
		_options: TransportCloseOptions = {},
	): Promise<void> {
		if (this.currentState === 'closed') return;
		this.terminalReason = reason;
		this.transition('closing', reason);
		try {
			this.socket?.close(closeCode(reason), reason.message?.slice(0, 120));
		} catch {
			/* ignored */
		}
		this.finishIncoming();
		this.transition('closed', reason);
	}

	onStateChange(
		listener: (state: TransportState, reason?: TransportCloseReason) => void,
	): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private attachSocket(socket: WebSocketLike): void {
		addListener(socket, 'message', (event: WebSocketEvent | unknown) => {
			try {
				const data = normalizeMessageData(
					isEventObject(event) && 'data' in event ? event.data : event,
				);
				validateTransportFrame(data, this.maxFrameBytes);
				this.push(data);
			} catch (cause) {
				void this.close({
					code: 'protocol_error',
					message: 'remote stream received an invalid frame',
					cause,
				});
			}
		});
		addListener(socket, 'error', (event: unknown) => {
			if (this.currentState === 'closed' || this.currentState === 'closing')
				return;
			const socketEvent = normalizeWebSocketEvent(event);
			this.transition('failed', {
				code: 'unavailable',
				message: 'remote stream failed',
				cause: socketEvent.error,
			});
			this.finishIncoming();
		});
		addListener(socket, 'close', (event: unknown) => {
			if (this.currentState === 'closed') return;
			const reason = this.terminalReason ?? closeReason(normalizeWebSocketEvent(event));
			this.transition('closed', reason);
			this.finishIncoming();
		});
	}

	private nextIncoming(): Promise<IteratorResult<Uint8Array>> {
		const value = this.values.shift();
		if (value !== undefined) {
			this.buffered -= value.byteLength;
			return Promise.resolve({ value, done: false });
		}
		if (this.currentState === 'closed' || this.currentState === 'failed')
			return Promise.resolve({ value: undefined, done: true });
		return new Promise((resolve) => this.waiters.push(resolve));
	}

	private push(value: Uint8Array): void {
		const waiter = this.waiters.shift();
		if (waiter !== undefined) {
			waiter({ value, done: false });
			return;
		}
		this.values.push(value);
		this.buffered += value.byteLength;
	}

	private finishIncoming(): void {
		while (this.waiters.length > 0)
			this.waiters.shift()?.({ value: undefined, done: true });
		this.values.length = 0;
		this.buffered = 0;
	}

	private transition(
		state: TransportState,
		reason?: TransportCloseReason,
	): void {
		this.currentState = state;
		for (const listener of [...this.listeners]) listener(state, reason);
	}
}

function streamUrl(origin: string, path: string): string {
	const url = new URL(origin);
	if (url.search !== '' || url.hash !== '')
		throw new TypeError('remote stream origin must not include query or fragment');
	if (url.protocol === 'https:') url.protocol = 'wss:';
	else if (url.protocol === 'http:') url.protocol = 'ws:';
	else throw new TypeError('remote stream origin must use HTTP or HTTPS');
	url.pathname = path.startsWith('/') ? path : `/${path}`;
	url.search = '';
	url.hash = '';
	return url.toString();
}

function base64UrlEncodeUtf8(value: string): string {
	if (value.length < 16 || value.length > 512 || /[\r\n]/u.test(value))
		throw new TypeError('remote stream credential is invalid');
	const bytes = new TextEncoder().encode(value);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	const base64 = globalThis.btoa(binary);
	return base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function normalizeMessageData(data: unknown): Uint8Array {
	if (data instanceof Uint8Array) return data;
	if (data instanceof ArrayBuffer) return new Uint8Array(data);
	if (ArrayBuffer.isView(data))
		return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	throw new TypeError('remote stream messages must be binary');
}

function addListener(
	socket: WebSocketLike,
	type: string,
	listener: (...args: unknown[]) => void,
): void {
	if (socket.addEventListener !== undefined)
		socket.addEventListener(type, listener as (event: WebSocketEvent) => void);
	else socket.on?.(type, listener);
}

function removeListener(
	socket: WebSocketLike,
	type: string,
	listener: (...args: unknown[]) => void,
): void {
	if (socket.removeEventListener !== undefined)
		socket.removeEventListener(type, listener as (event: WebSocketEvent) => void);
	else socket.off?.(type, listener);
}

function closeCode(reason: TransportCloseReason): number {
	if (reason.code === 'protocol_error') return 1002;
	if (reason.code === 'unauthorized') return 1008;
	if (reason.code === 'unavailable') return 1013;
	return 1000;
}

function closeReason(event: WebSocketEvent): TransportCloseReason {
	if (event.code === 1008) return { code: 'unauthorized', message: event.reason };
	if (event.code === 1002)
		return { code: 'protocol_error', message: event.reason };
	if (event.code === 1013) return { code: 'unavailable', message: event.reason };
	return { code: 'normal', message: event.reason };
}

function abortError(signal?: AbortSignal): Error {
	return signal?.reason instanceof Error
		? signal.reason
		: new DOMException('The operation was aborted', 'AbortError');
}

function isEventObject(value: unknown): value is WebSocketEvent {
	return typeof value === 'object' && value !== null;
}

function normalizeWebSocketEvent(value: unknown): WebSocketEvent {
	return isEventObject(value) ? value : {};
}
