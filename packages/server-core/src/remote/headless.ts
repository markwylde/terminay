import type { ProtocolId } from '@terminay/protocol';
import { abortIfSignalled, validateTransportFrame } from '@terminay/protocol';
import type {
	RemoteAuthProof,
	RemoteConnectionManager,
	RemotePeerSnapshot,
	RemoteTrafficChannel,
} from './transport.js';

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
		let channels:
			| ReadonlyMap<RemoteTrafficChannel, HeadlessDataChannel>
			| undefined;
		try {
			abortIfSignalled(signal);
			channels = await adapter.connect({
				peerId: peer.peerId,
				deviceId: peer.deviceId,
				serverId: this.manager.serverId,
				sessionOrigin: this.manager.sessionOrigin,
				channels: CHANNELS,
				maxFrameBytes: this.maxFrameBytes,
				maxBufferedBytes: this.maxBufferedBytes,
				signal,
			});
			abortIfSignalled(signal);
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
			this.manager.closePeer(peer.peerId);
			throw error;
		}
	}

	async closeAll(): Promise<void> {
		const sessions = [...this.sessions.values()];
		await Promise.all(sessions.map(async (session) => session.close()));
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
		const count = this.manager.revokeDevice(deviceId);
		const sessions = [...this.sessions.values()].filter(
			(session) => session.deviceId === deviceId,
		);
		await Promise.all(sessions.map(async (session) => session.close()));
		return count;
	}
}

export class RemoteHeadlessSession {
	private stateValue: 'connected' | 'closed' = 'connected';
	private readonly removeListeners: Array<() => void> = [];

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
		for (const channelName of CHANNELS) {
			const channel = channels.get(channelName);
			if (channel === undefined)
				throw new Error('headless WebRTC channel is missing');
			this.removeListeners.push(
				channel.onMessage((frame) => this.receive(channelName, frame)),
			);
			this.removeListeners.push(
				channel.onStateChange((state) => {
					if (state === 'closed' || state === 'closing') void this.close();
				}),
			);
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
