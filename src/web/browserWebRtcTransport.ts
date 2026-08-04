import {
	DEFAULT_PROTOCOL_LIMITS,
	validateTransportFrame,
	type ByteTransport,
	type TransportCloseReason,
	type TransportState,
} from '@terminay/protocol';

export const BROWSER_WEBRTC_CHANNELS = Object.freeze([
	'control',
	'application',
	'terminal',
	'assets',
] as const);

export type BrowserWebRtcChannelName = (typeof BROWSER_WEBRTC_CHANNELS)[number];

type IncomingWaiter = Readonly<{
	resolve(result: IteratorResult<Uint8Array>): void;
	reject(reason?: unknown): void;
}>;

/** Canonical framed client transport over the isolated WebRTC application
 * lane. All four lanes must be open before the application protocol is
 * exposed; closing one lane closes the complete authenticated session. */
export async function createBrowserWebRtcTransport(
	resolveChannel: (name: BrowserWebRtcChannelName) => RTCDataChannel | Promise<RTCDataChannel>,
): Promise<ByteTransport> {
	const channels = new Map<BrowserWebRtcChannelName, RTCDataChannel>();
	const identities = new Set<RTCDataChannel>();
	for (const name of BROWSER_WEBRTC_CHANNELS) {
		const channel = await resolveChannel(name);
		if (channel.label !== name) {
			closeChannels(channels);
			channel.close();
			throw new Error(`WebRTC ${name} channel has mismatched label ${channel.label}.`);
		}
		if (identities.has(channel)) {
			closeChannels(channels);
			throw new Error(`WebRTC ${name} channel aliases another traffic lane.`);
		}
		identities.add(channel);
		await waitForOpen(channel);
		channel.binaryType = 'arraybuffer';
		channels.set(name, channel);
	}
	const application = channels.get('application');
	if (application === undefined) throw new Error('WebRTC application channel is unavailable.');
	return new BrowserApplicationTransport(application, channels);
}

function closeChannels(channels: ReadonlyMap<BrowserWebRtcChannelName, RTCDataChannel>): void {
	for (const channel of channels.values()) channel.close();
}

class BrowserApplicationTransport implements ByteTransport {
	private currentState: TransportState = 'open';
	private readonly inbound: Uint8Array[] = [];
	private readonly waiters: IncomingWaiter[] = [];
	private readonly listeners = new Set<(state: TransportState, reason?: TransportCloseReason) => void>();

	constructor(
		private readonly application: RTCDataChannel,
		private readonly channels: ReadonlyMap<BrowserWebRtcChannelName, RTCDataChannel>,
	) {
		application.addEventListener('message', (event) => this.receive(event.data));
		for (const channel of channels.values()) {
			channel.addEventListener('close', () => this.finish({ code: 'unavailable', message: 'WebRTC channel closed.' }));
			channel.addEventListener('error', () => this.finish({ code: 'unavailable', message: 'WebRTC channel failed.' }, true));
		}
	}

	get state(): TransportState { return this.currentState; }
	get queuedBytes(): number { return this.application.bufferedAmount; }
	get bufferedBytes(): number { return this.inbound.reduce((total, frame) => total + frame.byteLength, 0); }
	get incoming(): AsyncIterable<Uint8Array> {
		return { [Symbol.asyncIterator]: () => ({ next: () => this.next() }) };
	}

	async open(signal?: AbortSignal): Promise<void> {
		if (signal?.aborted) throw signal.reason;
		if (this.currentState !== 'open') throw new Error('WebRTC application transport is closed.');
	}

	async send(frame: Uint8Array, options: { readonly signal?: AbortSignal } = {}): Promise<void> {
		if (options.signal?.aborted) throw options.signal.reason;
		validateTransportFrame(frame, DEFAULT_PROTOCOL_LIMITS.maxFrameBytes);
		if (this.currentState !== 'open' || this.application.readyState !== 'open') {
			throw new Error('WebRTC application transport is closed.');
		}
		this.application.send(frame.slice());
	}

	async waitForWritable(requiredBytes = 1, signal?: AbortSignal): Promise<void> {
		if (signal?.aborted) throw signal.reason;
		if (!Number.isSafeInteger(requiredBytes) || requiredBytes < 1 || requiredBytes > DEFAULT_PROTOCOL_LIMITS.maxQueuedBytes) {
			throw new RangeError('WebRTC writable size is invalid.');
		}
		while (this.application.bufferedAmount + requiredBytes > DEFAULT_PROTOCOL_LIMITS.maxQueuedBytes) {
			if (this.currentState !== 'open') throw new Error('WebRTC application transport is closed.');
			await new Promise<void>((resolve, reject) => {
				const timeout = window.setTimeout(resolve, 10);
				signal?.addEventListener('abort', () => {
					window.clearTimeout(timeout);
					reject(signal.reason);
				}, { once: true });
			});
		}
	}

	async close(reason: TransportCloseReason = { code: 'normal' }): Promise<void> {
		if (this.currentState === 'closed' || this.currentState === 'failed') return;
		this.currentState = 'closing';
		for (const listener of this.listeners) listener('closing', reason);
		for (const channel of this.channels.values()) channel.close();
		this.finish(reason);
	}

	onStateChange(listener: (state: TransportState, reason?: TransportCloseReason) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private receive(value: unknown): void {
		const frame = value instanceof ArrayBuffer
			? new Uint8Array(value)
			: ArrayBuffer.isView(value)
				? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
				: undefined;
		if (frame === undefined) {
			this.finish({ code: 'protocol_error', message: 'WebRTC application frame must be binary.' }, true);
			return;
		}
		validateTransportFrame(frame, DEFAULT_PROTOCOL_LIMITS.maxFrameBytes);
		const waiter = this.waiters.shift();
		if (waiter !== undefined) waiter.resolve({ done: false, value: frame.slice() });
		else this.inbound.push(frame.slice());
	}

	private next(): Promise<IteratorResult<Uint8Array>> {
		const frame = this.inbound.shift();
		if (frame !== undefined) return Promise.resolve({ done: false, value: frame });
		if (this.currentState === 'closed') return Promise.resolve({ done: true, value: undefined });
		if (this.currentState === 'failed') return Promise.reject(new Error('WebRTC application transport failed.'));
		return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
	}

	private finish(reason: TransportCloseReason, failed = false): void {
		if (this.currentState === 'closed' || this.currentState === 'failed') return;
		this.currentState = failed ? 'failed' : 'closed';
		for (const waiter of this.waiters.splice(0)) {
			if (failed) waiter.reject(new Error(reason.message ?? 'WebRTC application transport failed.'));
			else waiter.resolve({ done: true, value: undefined });
		}
		for (const listener of this.listeners) listener(this.currentState, reason);
	}
}

function waitForOpen(channel: RTCDataChannel): Promise<void> {
	if (channel.readyState === 'open') return Promise.resolve();
	if (channel.readyState === 'closed' || channel.readyState === 'closing') {
		return Promise.reject(new Error(`WebRTC ${channel.label} channel is closed.`));
	}
	return new Promise((resolve, reject) => {
		const opened = () => { cleanup(); resolve(); };
		const failed = () => { cleanup(); reject(new Error(`WebRTC ${channel.label} channel failed to open.`)); };
		const cleanup = () => {
			channel.removeEventListener('open', opened);
			channel.removeEventListener('close', failed);
			channel.removeEventListener('error', failed);
		};
		channel.addEventListener('open', opened);
		channel.addEventListener('close', failed);
		channel.addEventListener('error', failed);
	});
}
