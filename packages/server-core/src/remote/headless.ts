import type { ProtocolId } from '@terminay/protocol';
import { abortIfSignalled, validateTransportFrame } from '@terminay/protocol';
import type {
	RemoteAuthProof,
	RemoteConnectionManager,
	RemotePeerSnapshot,
	RemoteTrafficChannel,
} from './transport.js';
import { HeadlessChannelTransport, type HeadlessChannelTransportOptions } from './channelTransport.js';

export type HeadlessWebRtcRuntime = 'node-datachannel' | 'werift' | 'custom';
export type HeadlessDataChannelState =
	| 'connecting'
	| 'open'
	| 'closing'
	| 'closed';

export interface HeadlessDataChannel {
	readonly label: string;
	readonly readyState: HeadlessDataChannelState;
	readonly bufferedAmount: number;
	send(frame: Uint8Array): void;
	close(): void;
	onMessage(listener: (frame: Uint8Array) => void): () => void;
	onStateChange(
		listener: (state: HeadlessDataChannelState) => void,
	): () => void;
}

export interface HeadlessWebRtcRuntimeContext {
	readonly peerId: ProtocolId;
	readonly deviceId: ProtocolId;
	readonly serverId: ProtocolId;
	readonly sessionOrigin: string;
	readonly channels: readonly RemoteTrafficChannel[];
	readonly maxFrameBytes: number;
	readonly maxBufferedBytes: number;
	readonly signal: AbortSignal;
}

export interface HeadlessWebRtcRuntimeAdapter {
	readonly runtime: HeadlessWebRtcRuntime;
	connect(
		context: HeadlessWebRtcRuntimeContext,
	): Promise<ReadonlyMap<RemoteTrafficChannel, HeadlessDataChannel>>;
}

export interface RemoteHeadlessWebRtcFactoryOptions {
	readonly manager: RemoteConnectionManager;
	readonly runtimes: readonly HeadlessWebRtcRuntimeAdapter[];
	readonly maxFrameBytes?: number;
	readonly maxBufferedBytes?: number;
}

/**
 * Server-owned session host contract. Concrete hosts may use a native
 * displayless WebRTC implementation, while the exposure controller remains
 * independent of that implementation.
 */
export interface RemoteHeadlessSessionHost {
	connect(
		runtime: HeadlessWebRtcRuntime,
		proof: RemoteAuthProof,
		signal?: AbortSignal,
	): Promise<RemoteHeadlessSession>;
	listSessions(): readonly RemoteHeadlessSessionSnapshot[];
	/**
	 * Fence negotiations that have consumed admission but have not yet published
	 * a session. Exposure stop must not disconnect established peers.
	 */
	abortPendingConnections(): void;
	closeAll(): Promise<void>;
	revokeDevice(deviceId: ProtocolId): Promise<number>;
}

export interface RemoteHeadlessSessionSnapshot {
	readonly peerId: ProtocolId;
	readonly deviceId: ProtocolId;
	readonly runtime: HeadlessWebRtcRuntime;
	readonly state: 'connected' | 'closed';
	readonly peer: RemotePeerSnapshot;
}

const CHANNELS: readonly RemoteTrafficChannel[] = [
	'control',
	'application',
	'terminal',
	'assets',
];
const RUNTIMES: readonly HeadlessWebRtcRuntime[] = [
	'node-datachannel',
	'werift',
	'custom',
];

/**
 * A transport-neutral boundary around a displayless WebRTC runtime. Concrete
 * node-datachannel and Werift adapters are injected by the host; this class
 * owns runtime selection, server/origin admission, channel shape, and bounded
 * frame/backpressure rules without importing either implementation.
 */
export class RemoteHeadlessWebRtcFactory {
	private readonly manager: RemoteConnectionManager;
	private readonly runtimes = new Map<
		HeadlessWebRtcRuntime,
		HeadlessWebRtcRuntimeAdapter
	>();
	private readonly maxFrameBytes: number;
	private readonly maxBufferedBytes: number;
	private readonly sessions = new Map<ProtocolId, RemoteHeadlessSession>();
	/**
	 * Admission happens before a runtime has completed its WebRTC negotiation.
	 * Keep those attempts explicit so host shutdown can fence them too; otherwise
	 * a late adapter result could recreate a session after closeAll().
	 */
	private readonly connecting = new Map<
		ProtocolId,
		{ readonly controller: AbortController; readonly deviceId: ProtocolId }
	>();

	constructor(options: RemoteHeadlessWebRtcFactoryOptions) {
		this.manager = options.manager;
		this.maxFrameBytes = positive(
			options.maxFrameBytes ?? 1024 * 1024,
			'maxFrameBytes',
		);
		this.maxBufferedBytes = positive(
			options.maxBufferedBytes ?? 8 * 1024 * 1024,
			'maxBufferedBytes',
		);
		for (const adapter of options.runtimes) {
			if (!RUNTIMES.includes(adapter.runtime))
				throw new TypeError('headless WebRTC runtime is invalid');
			if (this.runtimes.has(adapter.runtime))
				throw new Error(
					`headless WebRTC runtime ${adapter.runtime} is already registered`,
				);
			this.runtimes.set(adapter.runtime, adapter);
		}
	}

	async connect(
		runtime: HeadlessWebRtcRuntime,
		proof: RemoteAuthProof,
		signal = new AbortController().signal,
	): Promise<RemoteHeadlessSession> {
		abortIfSignalled(signal);
		const adapter = this.runtimes.get(runtime);
		if (adapter === undefined)
			throw new Error(`headless WebRTC runtime ${runtime} is unavailable`);
		const peer = this.manager.admit(proof);
		const connectionAbort = new AbortController();
		const forwardAbort = () => connectionAbort.abort();
		signal.addEventListener('abort', forwardAbort, { once: true });
		this.connecting.set(peer.peerId, {
			controller: connectionAbort,
			deviceId: peer.deviceId,
		});
		let channels:
			| ReadonlyMap<RemoteTrafficChannel, HeadlessDataChannel>
			| undefined;
		try {
			abortIfSignalled(connectionAbort.signal);
			channels = await adapter.connect({
				peerId: peer.peerId,
				deviceId: peer.deviceId,
				serverId: this.manager.serverId,
				sessionOrigin: this.manager.sessionOrigin,
				channels: CHANNELS,
				maxFrameBytes: this.maxFrameBytes,
				maxBufferedBytes: this.maxBufferedBytes,
				signal: connectionAbort.signal,
			});
			abortIfSignalled(connectionAbort.signal);
			validateChannels(channels);
			const session = new RemoteHeadlessSession(
				this.manager,
				runtime,
				peer,
				channels,
				this.maxFrameBytes,
				this.maxBufferedBytes,
				() => this.sessions.delete(peer.peerId),
			);
			this.sessions.set(peer.peerId, session);
			return session;
		} catch (error) {
			closeChannels(channels);
			try {
				this.manager.closePeer(peer.peerId);
			} catch {
				/* closeAll() may already have fenced this admitted peer. */
			}
			throw error;
		} finally {
			signal.removeEventListener('abort', forwardAbort);
			this.connecting.delete(peer.peerId);
		}
	}

	async closeAll(): Promise<void> {
		// Pending runtime negotiation is an admitted resource too. Abort it and
		// release its manager slot synchronously; a non-cooperative adapter is
		// still unable to register a late session because its signal is fenced.
		for (const [peerId, connecting] of this.connecting) {
			connecting.controller.abort();
			try {
				this.manager.closePeer(peerId);
			} catch {
				/* A concurrent failed attempt has already released this peer. */
			}
		}
		this.connecting.clear();
		const sessions = [...this.sessions.values()];
		await Promise.all(sessions.map(async (session) => session.close()));
	}

	abortPendingConnections(): void {
		// Exposure stop blocks new connections but intentionally preserves live
		// sessions. A negotiation that has consumed a manager admission is neither:
		// abort it and release that slot before a late runtime result can publish.
		for (const [peerId, connecting] of this.connecting) {
			connecting.controller.abort();
			try {
				this.manager.closePeer(peerId);
			} catch {
				/* A concurrent failed attempt has already released this peer. */
			}
		}
		this.connecting.clear();
	}

	async closePeer(peerId: ProtocolId): Promise<void> {
		await this.sessions.get(peerId)?.close();
	}

	listSessions(): readonly RemoteHeadlessSessionSnapshot[] {
		return this.snapshot();
	}

	snapshot(): readonly RemoteHeadlessSessionSnapshot[] {
		const snapshots: RemoteHeadlessSessionSnapshot[] = [];
		for (const session of this.sessions.values()) {
			try {
				snapshots.push(session.snapshot());
			} catch {
				/* A peer revoked between iteration and snapshot is omitted. */
			}
		}
		return Object.freeze(snapshots);
	}

	async revokeDevice(deviceId: ProtocolId): Promise<number> {
		// An admitted runtime negotiation is a live device connection even before
		// it has published its session. Abort it first so a late adapter result
		// cannot reintroduce a peer after the manager revokes the device. Release
		// its admission synchronously too: a non-cooperative native runtime may
		// ignore the AbortSignal indefinitely, and must not leave a revoked peer in
		// the manager snapshot or consume lifecycle resources in the meantime.
		let pendingCount = 0;
		for (const [peerId, connecting] of this.connecting) {
			if (connecting.deviceId !== deviceId) continue;
			connecting.controller.abort();
			try {
				this.manager.closePeer(peerId);
				pendingCount += 1;
			} catch {
				/* A concurrent failed attempt has already released this peer. */
			}
			this.connecting.delete(peerId);
		}
		const count = this.manager.revokeDevice(deviceId);
		const sessions = [...this.sessions.values()].filter(
			(session) => session.deviceId === deviceId,
		);
		await Promise.all(sessions.map(async (session) => session.close()));
		return pendingCount + count;
	}
}

export class RemoteHeadlessSession {
	private stateValue: 'connected' | 'closed' = 'connected';
	private readonly removeListeners: Array<() => void> = [];
	private readonly transportConsumers = new Map<RemoteTrafficChannel, Set<(frame: Uint8Array) => void>>();

	constructor(
		private readonly manager: RemoteConnectionManager,
		private readonly runtime: HeadlessWebRtcRuntime,
		private readonly peer: RemotePeerSnapshot,
		private readonly channels: ReadonlyMap<
			RemoteTrafficChannel,
			HeadlessDataChannel
		>,
		private readonly maxFrameBytes: number,
		private readonly maxBufferedBytes: number,
		private readonly onClosed: () => void,
	) {
		// A native adapter can synchronously report a close while server-core is
		// registering its session observers. Do not let that re-entrant callback
		// publish a half-initialized session: defer normal session teardown until
		// construction is complete, then reject the whole allocation so the factory
		// retains the single cleanup attempt for every lane.
		let installingLifecycleListeners = true;
		let channelClosedDuringListenerRegistration = false;
		for (const channelName of CHANNELS) {
			const channel = channels.get(channelName);
			if (channel === undefined)
				throw new Error('headless WebRTC channel is missing');
			this.transportConsumers.set(channelName, new Set());
			this.removeListeners.push(
				channel.onMessage((frame) => {
					const consumers = this.transportConsumers.get(channelName);
					if (consumers !== undefined && consumers.size > 0) {
						for (const consumer of [...consumers]) consumer(frame);
					} else {
						this.receive(channelName, frame);
					}
				}),
			);
			this.removeListeners.push(
				channel.onStateChange((state) => {
					if (state !== 'closed' && state !== 'closing') return;
					if (installingLifecycleListeners) {
						channelClosedDuringListenerRegistration = true;
						return;
					}
					void this.close();
				}),
			);
		}
		installingLifecycleListeners = false;
		if (
			channelClosedDuringListenerRegistration ||
			CHANNELS.some((channelName) => channels.get(channelName)?.readyState !== 'open')
		) {
			for (const remove of this.removeListeners.splice(0)) remove();
			for (const consumers of this.transportConsumers.values()) consumers.clear();
			throw new Error('headless WebRTC channel closed during session listener registration');
		}
	}

	get state(): 'connected' | 'closed' {
		return this.stateValue;
	}
	get peerId(): ProtocolId {
		return this.peer.peerId;
	}
	get deviceId(): ProtocolId {
		return this.peer.deviceId;
	}

	/** Create a canonical ByteTransport for one isolated traffic channel. */
	createTransport(
		channelName: RemoteTrafficChannel,
		options: HeadlessChannelTransportOptions = {},
	): HeadlessChannelTransport {
		this.ensureConnected();
		const consumers = this.transportConsumers.get(channelName);
		if (consumers === undefined) throw new Error('headless WebRTC channel is missing');
		// A traffic class is one ordered protocol stream. Allowing two transports
		// to subscribe to the same native channel would duplicate an authenticated
		// command frame into independent application handlers. A reconnect must
		// close its previous transport before it can acquire the channel again.
		if (consumers.size !== 0)
			throw new Error(`remote ${channelName} transport is already attached`);
		return new HeadlessChannelTransport(this.requireChannel(channelName), options, (listener) => {
			consumers.add(listener);
			return () => consumers.delete(listener);
		});
	}

	/** Build one canonical transport per isolated traffic class. */
	createTransports(
		options: HeadlessChannelTransportOptions = {},
	): ReadonlyMap<RemoteTrafficChannel, HeadlessChannelTransport> {
		return new Map(CHANNELS.map((channelName) => [channelName, this.createTransport(channelName, options)]));
	}

	send(channelName: RemoteTrafficChannel, frame: Uint8Array): void {
		this.ensureConnected();
		const channel = this.requireChannel(channelName);
		validateTransportFrame(frame, this.maxFrameBytes);
		if (
			!Number.isSafeInteger(channel.bufferedAmount) ||
			channel.bufferedAmount < 0
		)
			throw new Error('headless WebRTC buffered amount is invalid');
		if (channel.bufferedAmount + frame.byteLength > this.maxBufferedBytes)
			throw new Error(
				`remote ${channelName} channel backpressure limit reached`,
			);
		channel.send(frame.slice());
	}

	drain(
		channelName: RemoteTrafficChannel,
		maxBytes = this.maxFrameBytes,
	): readonly Uint8Array[] {
		this.ensureConnected();
		this.requireChannel(channelName);
		return this.manager.drain(this.peer.peerId, channelName, maxBytes);
	}

	snapshot(): RemoteHeadlessSessionSnapshot {
		const peer = this.manager
			.snapshot()
			.peers.find((candidate) => candidate.peerId === this.peer.peerId);
		if (peer === undefined) throw new Error('remote session is closed');
		const state =
			this.stateValue === 'connected' && peer.state === 'connected'
				? 'connected'
				: 'closed';
		return Object.freeze({
			peerId: peer.peerId,
			deviceId: peer.deviceId,
			runtime: this.runtime,
			state,
			peer,
		});
	}

	async close(): Promise<void> {
		if (this.stateValue === 'closed') return;
		this.stateValue = 'closed';
		for (const remove of this.removeListeners.splice(0)) remove();
		for (const consumers of this.transportConsumers.values()) consumers.clear();
		closeChannels(this.channels);
		try {
			this.manager.closePeer(this.peer.peerId);
		} catch {
			/* an already-revoked peer is closed by the manager */
		}
		this.onClosed();
	}

	private receive(channelName: RemoteTrafficChannel, frame: Uint8Array): void {
		if (this.stateValue !== 'connected') return;
		try {
			this.ensureConnected();
			validateTransportFrame(frame, this.maxFrameBytes);
			this.manager.send(this.peer.peerId, channelName, frame);
		} catch {
			void this.close();
		}
	}

	private requireChannel(
		channelName: RemoteTrafficChannel,
	): HeadlessDataChannel {
		if (!CHANNELS.includes(channelName))
			throw new TypeError('remote traffic channel is invalid');
		const channel = this.channels.get(channelName);
		if (channel === undefined)
			throw new Error('headless WebRTC channel is missing');
		if (channel.readyState !== 'open')
			throw new Error(`remote ${channelName} channel is not open`);
		return channel;
	}

	private ensureConnected(): void {
		if (this.stateValue !== 'connected')
			throw new Error('remote session is closed');
		const peer = this.manager
			.snapshot()
			.peers.find((candidate) => candidate.peerId === this.peer.peerId);
		if (peer?.state !== 'connected') {
			void this.close();
			throw new Error('remote session is closed');
		}
	}
}

function validateChannels(
	channels: ReadonlyMap<RemoteTrafficChannel, HeadlessDataChannel>,
): void {
	if (!(channels instanceof Map) || channels.size !== CHANNELS.length)
		throw new Error('headless WebRTC channel set is invalid');
	for (const channelName of CHANNELS) {
		const channel = channels.get(channelName);
		if (
			channel === undefined ||
			channel.label !== channelName ||
			typeof channel.send !== 'function' ||
			typeof channel.close !== 'function' ||
			typeof channel.onMessage !== 'function' ||
			typeof channel.onStateChange !== 'function'
		)
			throw new Error('headless WebRTC channel set is invalid');
	}
}

function closeChannels(
	channels: ReadonlyMap<RemoteTrafficChannel, HeadlessDataChannel> | undefined,
): void {
	if (channels === undefined) return;
	for (const channel of channels.values()) {
		try {
			channel.close();
		} catch {
			/* cleanup is best effort after a failed adapter */
		}
	}
}

function positive(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value <= 0)
		throw new RangeError(`${name} must be positive`);
	return value;
}
