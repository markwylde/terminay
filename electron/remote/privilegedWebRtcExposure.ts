import {
	loadSelectedSecureWeriftRuntime,
	type SecureWeriftRuntimeModule,
} from '../../apps/terminay-server/src/remote/secureWeriftRuntime';
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
		options: Omit<RemoteAccessServiceOptions, 'createWebRtcHostWindow'>,
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

	private subscribe<T>(listeners: Set<(value: T) => void>, listener: (value: T) => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	}
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
