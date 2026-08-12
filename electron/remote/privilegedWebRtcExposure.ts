import {
	loadSelectedSecureWeriftRuntime,
	type SecureWeriftRuntimeModule,
} from '../../apps/terminay-server/src/remote/secureWeriftRuntime';
import {
	DEFAULT_PROTOCOL_LIMITS,
	validateTransportFrame,
	type ByteTransport,
	type TransportCloseReason,
	type TransportState,
} from '@terminay/protocol';
import type {
	AuthenticatedClient,
	ServerConnectionLike,
} from '../../packages/server-core/src/types';
import {
	runHost,
	type HostApi,
	type HostConfig,
} from '../../scripts/support/webRtcHostRuntime';
import {
	RemoteAccessService,
	type RemoteAccessServiceOptions,
} from './service';

type PeerConnectionConstructor = new (
	configuration?: RTCConfiguration,
) => RTCPeerConnection;

type PrivilegedWebRtcExposureOptions = Omit<
	RemoteAccessServiceOptions,
	'createWebRtcHostWindow'
> & {
	acceptApplicationTransport: (transport: ByteTransport, client: AuthenticatedClient) => ServerConnectionLike;
};

/**
 * Main-process-only adapter for the deployed v1 hosted bootstrap protocol.
 *
 * The old implementation ran this peer in a hidden Electron renderer. This
 * adapter deliberately keeps the same deployed wire contract while moving the
 * runtime, signaling, asset access, device enrollment and terminal authority
 * into the privileged process on the integrity-selected Werift artifact.
 */
export class PrivilegedWebRtcExposure {
	readonly service: RemoteAccessService;
	private sequence = 1_000_000;
	private readonly peers = new Map<number, PrivilegedPeer>();
	private runtime: Promise<SecureWeriftRuntimeModule> | undefined;

	constructor(
		private readonly runtimeRoot: string,
		private readonly options: PrivilegedWebRtcExposureOptions,
	) {
		this.service = new RemoteAccessService({
			...options,
			createWebRtcHostWindow: () => this.createPeer(),
		});
	}

	async shutdown(): Promise<void> {
		if (this.service.getStatus().isRunning) await this.service.toggle();
		for (const peer of this.peers.values()) peer.close();
		this.peers.clear();
	}

	async toggle(): Promise<ReturnType<RemoteAccessService['getStatus']>> {
		if (!this.service.getStatus().isRunning) await this.loadRuntime();
		return this.service.toggle();
	}

	private createPeer(): ReturnType<RemoteAccessServiceOptions['createWebRtcHostWindow']> {
		const id = this.sequence++;
		const peer = new PrivilegedPeer({
			acceptApplicationTransport: this.options.acceptApplicationTransport,
			id,
			runtime: () => this.loadRuntime(),
			service: () => this.service,
			onClosed: () => this.peers.delete(id),
		});
		this.peers.set(id, peer);
		return peer.host;
	}

	private loadRuntime(): Promise<SecureWeriftRuntimeModule> {
		this.runtime ??= loadSelectedSecureWeriftRuntime(this.runtimeRoot);
		return this.runtime;
	}
}

class PrivilegedPeer {
	private applicationChannelId: string | undefined;
	private applicationConnection: ServerConnectionLike | undefined;
	private readonly configListeners = new Set<(config: HostConfig) => void>();
	private readonly signalListeners = new Set<(message: unknown) => void>();
	private readonly terminalListeners = new Set<
		(message: { channelId: string; message: string }) => void
	>();
	private readonly terminalCloseListeners = new Set<
		(message: { channelId: string; reason?: string }) => void
	>();
	private cleanup: (() => void) | undefined;
	private closed = false;
	private destroyedListener: (() => void) | undefined;
	private startSequence = 0;

	readonly host: ReturnType<RemoteAccessServiceOptions['createWebRtcHostWindow']>;

	constructor(
		private readonly options: Readonly<{
			acceptApplicationTransport: (transport: ByteTransport, client: AuthenticatedClient) => ServerConnectionLike;
			id: number;
			runtime: () => Promise<SecureWeriftRuntimeModule>;
			service: () => RemoteAccessService;
			onClosed: () => void;
		}>,
	) {
		this.host = {
			close: () => this.close(),
			closeTerminal: (channelId, reason) => {
				for (const listener of this.terminalCloseListeners)
					listener({ channelId, ...(reason === undefined ? {} : { reason }) });
			},
			onDestroyed: (listener) => {
				this.destroyedListener = listener;
				return () => {
					if (this.destroyedListener === listener)
						this.destroyedListener = undefined;
				};
			},
			sendConfig: (config) => {
				for (const listener of this.configListeners) listener(config);
				void this.start(config);
			},
			sendSignalMessage: (message) => {
				for (const listener of this.signalListeners) listener(message);
			},
			sendTerminalMessage: (channelId, message) => {
				for (const listener of this.terminalListeners)
					listener({ channelId, message });
			},
			webContentsId: options.id,
		};
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.startSequence += 1;
		this.cleanup?.();
		this.cleanup = undefined;
		const applicationChannelId = this.applicationChannelId;
		this.applicationChannelId = undefined;
		void this.applicationConnection?.close();
		this.applicationConnection = undefined;
		if (applicationChannelId !== undefined) {
			this.options.service().closeWebRtcApplication(applicationChannelId);
		}
		this.configListeners.clear();
		this.signalListeners.clear();
		this.terminalListeners.clear();
		this.terminalCloseListeners.clear();
		const destroyed = this.destroyedListener;
		this.destroyedListener = undefined;
		this.options.onClosed();
		destroyed?.();
	}

	private async start(config: HostConfig): Promise<void> {
		const sequence = ++this.startSequence;
		try {
			this.cleanup?.();
			this.cleanup = undefined;
			const runtime = await this.options.runtime();
			if (this.closed || sequence !== this.startSequence) return;
			const service = this.options.service();
			const api: HostApi = {
				attachApplication: (channelId, ticket, channel) =>
					this.attachApplication(channelId, ticket, channel),
				closeApplication: (channelId) => this.closeApplication(channelId),
				attachTerminal: (channelId, ticket) =>
					service.attachWebRtcTerminal(this.options.id, channelId, ticket),
				closeTerminal: (channelId, reason) =>
					service.closeWebRtcTerminal(channelId, reason),
				getAsset: (path) => service.getWebRtcAsset(path),
				getAssetManifest: () => service.getWebRtcAssetManifest(),
				getConfig: async () => service.getWebRtcHostConfig(this.options.id),
				handleApiRequest: (pathname, body, appOrigin) =>
					service.handleWebRtcApiRequest(pathname, body, appOrigin),
				handleTerminalMessage: (channelId, message) =>
					service.handleWebRtcTerminalMessage(channelId, message),
				onConfig: (listener) => this.subscribe(this.configListeners, listener),
				onSignalMessage: (listener) =>
					this.subscribe(this.signalListeners, listener),
				onTerminalCloseRequest: (listener) =>
					this.subscribe(this.terminalCloseListeners, listener),
				onTerminalMessage: (listener) =>
					this.subscribe(this.terminalListeners, listener),
				openSignal: () =>
					service.handleWebRtcHostSignalReady(this.options.id),
				sendSignalMessage: (message) =>
					service.handleWebRtcHostSignalMessage(this.options.id, message),
				updateStatus: (message) =>
					service.handleWebRtcHostStatus(this.options.id, message),
			};
			const cleanup = await runHost(config, {
				api,
				createPeerConnection: (configuration) =>
					createPrivilegedPeerConnection(runtime, configuration),
			});
			if (this.closed || sequence !== this.startSequence) cleanup();
			else this.cleanup = cleanup;
		} catch (error) {
			if (this.closed || sequence !== this.startSequence) return;
			this.options.service().handleWebRtcHostStatus(this.options.id, {
				detail:
					error instanceof Error
						? error.message
						: 'Privileged WebRTC peer failed to start.',
				type: 'error',
			});
		}
	}

	private async attachApplication(
		channelId: string,
		ticket: string,
		channel: RTCDataChannel,
	): Promise<void> {
		if (this.closed) throw new Error('The WebRTC peer is closed.');
		if (this.applicationConnection !== undefined) {
			throw new Error('The canonical application transport is already authenticated.');
		}
		const authenticated = await this.options.service().attachWebRtcApplication(
			this.options.id,
			channelId,
			ticket,
			(reason) => this.closeWithReason(reason),
		);
		this.applicationChannelId = channelId;
		try {
			const transport = createRtcDataChannelTransport(channel);
			const connection = this.options.acceptApplicationTransport(transport, {
				clientId: authenticated.deviceId,
				authScope: 'admin',
			});
			this.applicationConnection = connection;
			void connection.start().catch((error) => {
				if (!this.closed) {
					this.options.service().handleWebRtcHostStatus(this.options.id, {
						detail: error instanceof Error ? error.message : 'Canonical application connection failed.',
						type: 'error',
					});
					this.close();
				}
			});
		} catch (error) {
			this.options.service().closeWebRtcApplication(channelId);
			this.applicationChannelId = undefined;
			throw error;
		}
	}

	private closeWithReason(_reason?: string): void {
		this.close();
	}

	private closeApplication(channelId: string): void {
		if (channelId !== this.applicationChannelId) return;
		this.applicationChannelId = undefined;
		void this.applicationConnection?.close();
		this.applicationConnection = undefined;
		this.options.service().closeWebRtcApplication(channelId);
	}

	private subscribe<T>(listeners: Set<(value: T) => void>, listener: (value: T) => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	}
}

export function createRtcDataChannelTransport(channel: RTCDataChannel): ByteTransport {
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
		this.currentState = channel.readyState === 'open'
			? 'open'
			: channel.readyState === 'connecting'
				? 'opening'
				: 'closed';
		channel.binaryType = 'arraybuffer';
		channel.addEventListener('open', () => this.setState('open'));
		channel.addEventListener('message', (event) => this.receive(event.data));
		channel.addEventListener('close', () => this.finish({ code: 'unavailable', message: 'WebRTC application channel closed.' }));
		channel.addEventListener('error', () => this.finish({ code: 'unavailable', message: 'WebRTC application channel failed.' }, true));
	}

	get state(): TransportState { return this.currentState; }
	get queuedBytes(): number {
		try { return this.readBufferedAmount(); } catch { return 0; }
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
			if (this.channel.readyState === 'closing' || this.channel.readyState === 'closed') {
				this.finish({ code: 'unavailable', message: 'WebRTC application channel closed before opening.' }, true);
				break;
			}
			await rtcAbortableDelay(signal);
		}
		if (this.currentState !== 'open') throw new Error('WebRTC application transport is closed.');
	}

	async send(frame: Uint8Array, options: { readonly signal?: AbortSignal } = {}): Promise<void> {
		if (options.signal?.aborted) throw options.signal.reason;
		validateTransportFrame(frame, DEFAULT_PROTOCOL_LIMITS.maxFrameBytes);
		await this.waitForWritable(frame.byteLength, options.signal);
		this.assertWritable();
		try {
			this.channel.send(frame.slice());
		} catch (cause) {
			this.finish({ code: 'unavailable', message: 'WebRTC application send failed.', cause }, true);
			throw cause;
		}
	}

	async waitForWritable(requiredBytes = 1, signal?: AbortSignal): Promise<void> {
		if (!Number.isSafeInteger(requiredBytes) || requiredBytes < 1 || requiredBytes > DEFAULT_PROTOCOL_LIMITS.maxQueuedBytes) {
			throw new RangeError('WebRTC writable size is invalid.');
		}
		while (this.readBufferedAmount() + requiredBytes > DEFAULT_PROTOCOL_LIMITS.maxQueuedBytes) {
			this.assertWritable();
			await rtcAbortableDelay(signal);
		}
		if (signal?.aborted) throw signal.reason;
		this.assertWritable();
	}

	async close(reason: TransportCloseReason = { code: 'normal' }): Promise<void> {
		if (this.currentState === 'closed' || this.currentState === 'failed') return;
		this.setState('closing', reason);
		this.channel.close();
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
		try {
			validateTransportFrame(frame, DEFAULT_PROTOCOL_LIMITS.maxFrameBytes);
		} catch {
			this.finish({ code: 'protocol_error', message: 'WebRTC application frame is invalid.' }, true);
			return;
		}
		const waiter = this.waiters.shift();
		if (waiter) waiter.resolve({ done: false, value: frame.slice() });
		else this.inbound.push(frame.slice());
	}

	private next(): Promise<IteratorResult<Uint8Array>> {
		const frame = this.inbound.shift();
		if (frame) return Promise.resolve({ done: false, value: frame });
		if (this.currentState === 'closed') return Promise.resolve({ done: true, value: undefined });
		if (this.currentState === 'failed') return Promise.reject(new Error('WebRTC application transport failed.'));
		return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
	}

	private finish(reason: TransportCloseReason, failed = false): void {
		if (this.currentState === 'closed' || this.currentState === 'failed') return;
		this.setState(failed ? 'failed' : 'closed', reason);
		this.inbound.splice(0);
		if (this.channel.readyState !== 'closed') {
			try { this.channel.close(); } catch { /* Best effort after terminal failure. */ }
		}
		for (const waiter of this.waiters.splice(0)) {
			if (failed) waiter.reject(new Error(reason.message ?? 'WebRTC application transport failed.'));
			else waiter.resolve({ done: true, value: undefined });
		}
	}

	private setState(state: TransportState, reason?: TransportCloseReason): void {
		this.currentState = state;
		for (const listener of [...this.listeners]) {
			try { listener(state, reason); } catch { /* Observers cannot break transport lifecycle. */ }
		}
	}

	private assertWritable(): void {
		if (this.currentState === 'open' && this.channel.readyState === 'open') return;
		if (this.currentState === 'open') this.finish({ code: 'unavailable', message: 'WebRTC application channel is not open.' }, true);
		throw new Error('WebRTC application transport is closed.');
	}

	private readBufferedAmount(): number {
		const value = this.channel.bufferedAmount;
		if (!Number.isSafeInteger(value) || value < 0 || value > DEFAULT_PROTOCOL_LIMITS.maxQueuedBytes * 2) {
			this.finish({ code: 'resource', message: 'WebRTC application buffered amount is invalid.' }, true);
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

function createPrivilegedPeerConnection(
	runtime: SecureWeriftRuntimeModule,
	configuration: RTCConfiguration,
): RTCPeerConnection {
	const PeerConnection =
		runtime.RTCPeerConnection as unknown as PeerConnectionConstructor;
	const peer = new PeerConnection({
		...configuration,
		maxMessageSize: 1024 * 1024,
	} as RTCConfiguration);

	// Werift emits gathered candidates while setLocalDescription is still
	// producing the offer. Preserve signaling order by releasing those candidates
	// only after the authenticated browser answer has been installed.
	const addEventListener = peer.addEventListener.bind(peer);
	const setRemoteDescription = peer.setRemoteDescription.bind(peer);
	const queuedIceEvents: Array<() => void> = [];
	let remoteDescriptionInstalled = false;
	peer.addEventListener = ((
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: AddEventListenerOptions | boolean,
	) => {
		if (type !== 'icecandidate') {
			addEventListener(
				type as keyof RTCPeerConnectionEventMap,
				listener as EventListener,
				options,
			);
			return;
		}
		addEventListener(
			'icecandidate',
			((event: Event) => {
				const candidate = (event as unknown as RTCPeerConnectionIceEvent)
					.candidate;
				const candidateJson = candidate
					? (JSON.parse(
							JSON.stringify(candidate.toJSON()),
						) as RTCIceCandidateInit)
					: null;
				const normalizedEvent = {
					candidate: candidateJson
						? { toJSON: () => candidateJson }
						: null,
					type: 'icecandidate',
				} as unknown as Event;
				const deliver = () => {
					if (typeof listener === 'function') listener(normalizedEvent);
					else listener.handleEvent(normalizedEvent);
				};
				if (remoteDescriptionInstalled) deliver();
				else queuedIceEvents.push(deliver);
			}) as EventListener,
			options,
		);
	}) as RTCPeerConnection['addEventListener'];
	peer.setRemoteDescription = (async (
		description: RTCSessionDescriptionInit,
	) => {
		await setRemoteDescription(description);
		remoteDescriptionInstalled = true;
		for (const deliver of queuedIceEvents.splice(0)) deliver();
	}) as RTCPeerConnection['setRemoteDescription'];
	return peer;
}
