import type {
	HeadlessDataChannel,
	RemoteTrafficChannel,
} from '@terminay/server-core/remote';
import { DEFAULT_SCTP_MAX_MESSAGE_BYTES } from './uiArchiveTransfer.js';

/**
 * What a peer opener is told about the connection it is establishing.
 *
 * server-core no longer owns a headless-runtime abstraction; this contract now
 * lives with the privileged edge that actually implements it.
 */
export interface HeadlessWebRtcRuntimeContext {
	readonly peerId: string;
	readonly deviceId: string;
	readonly serverId: string;
	readonly sessionOrigin: string;
	readonly channels: readonly RemoteTrafficChannel[];
	readonly maxFrameBytes: number;
	/** Largest single native message a lane accepts. Frames above it are sent
	 * as fragments the peer reassembles. Defaults to the SCTP-safe bound. */
	readonly maxMessageBytes?: number;
	readonly maxBufferedBytes: number;
	readonly signal: AbortSignal;
}

export interface HeadlessWebRtcRuntimeAdapter {
	readonly runtime: 'node-datachannel' | 'werift';
	connect(
		context: HeadlessWebRtcRuntimeContext,
	): Promise<ReadonlyMap<RemoteTrafficChannel, HeadlessDataChannel>>;
}

/** Minimal node-datachannel surface kept at the privileged application edge. */
export interface NodeDataChannelLike {
	getLabel(): string;
	isOpen(): boolean;
	bufferedAmount(): number;
	sendMessageBinary(frame: Uint8Array): boolean;
	onMessage(listener: (message: unknown) => void): void;
	onClosed(listener: () => void): void;
	close(): void;
}

export interface NodeDataChannelRuntimeModule {
	readonly PeerConnection: unknown;
	readonly cleanup?: () => void;
}

export interface NodeDataChannelRuntimeAdapterOptions {
	/** Runtime identity for a compatibility-shaped peer module. Production
	 * Secure-Werift uses the same hardened channel boundary without claiming to
	 * be the blocked node-datachannel implementation. */
	readonly runtime?: 'node-datachannel' | 'werift';
	/** Injected for tests or a host that already loaded the native module. */
	readonly module?: NodeDataChannelRuntimeModule;
	/** Dynamic loader keeps the optional native dependency out of server-core. */
	readonly loadModule?: () => Promise<NodeDataChannelRuntimeModule>;
	/** Signaling/peer setup remains a server-host concern. */
	readonly openChannels: (
		module: NodeDataChannelRuntimeModule,
		context: HeadlessWebRtcRuntimeContext,
	) =>
		| Promise<ReadonlyMap<string, NodeDataChannelLike>>
		| ReadonlyMap<string, NodeDataChannelLike>;
}

/**
 * Load an optional node-datachannel installation at the privileged server
 * boundary. No native WebRTC package is imported by server-core or shared
 * browser code; an unavailable module fails with a typed setup error.
 */
export async function loadNodeDataChannelRuntimeModule(
	specifier = 'node-datachannel',
): Promise<NodeDataChannelRuntimeModule> {
	if (
		typeof specifier !== 'string' ||
		specifier.length === 0 ||
		specifier.length > 256
	)
		throw new TypeError('node-datachannel module specifier is invalid');
	try {
		const loaded = (await import(specifier)) as {
			readonly default?: unknown;
			readonly PeerConnection?: unknown;
			readonly cleanup?: unknown;
		};
		const candidate = loaded.default ?? loaded;
		return validateRuntimeModule(candidate);
	} catch (error) {
		if (
			error instanceof TypeError &&
			/PeerConnection|module/i.test(error.message)
		)
			throw error;
		const unavailable = new Error('node-datachannel runtime is unavailable');
		(unavailable as Error & { cause?: unknown }).cause = error;
		throw unavailable;
	}
}

/**
 * Adapt one established node-datachannel peer to the transport-neutral server
 * channel contract. This adapter does not perform signaling; `openChannels`
 * is where the server host supplies its authenticated offer/answer lifecycle.
 */
export function createNodeDataChannelRuntimeAdapter(
	options: NodeDataChannelRuntimeAdapterOptions,
): HeadlessWebRtcRuntimeAdapter {
	if (typeof options.openChannels !== 'function')
		throw new TypeError('node-datachannel channel opener is required');
	if (options.module === undefined && options.loadModule === undefined)
		throw new TypeError('node-datachannel module or loader is required');
	if (options.module !== undefined && options.loadModule !== undefined)
		throw new TypeError(
			'node-datachannel module and loader are mutually exclusive',
		);
	let loadedModule: Promise<NodeDataChannelRuntimeModule> | undefined;
	const resolveModule = (): Promise<NodeDataChannelRuntimeModule> => {
		if (options.module !== undefined)
			return Promise.resolve(validateRuntimeModule(options.module));
		if (loadedModule === undefined) {
			loadedModule = Promise.resolve(options.loadModule?.()).then((module) =>
				validateRuntimeModule(module),
			);
		}
		return loadedModule;
	};
	return {
		runtime: options.runtime ?? 'node-datachannel',
		async connect(context) {
			validateRequestedChannels(context.channels);
			const module = await resolveModule();
			const nativeChannels = await options.openChannels(module, context);
			if (!(nativeChannels instanceof Map))
				throw new TypeError('node-datachannel channel set is invalid');
			// Native peer/channel allocation is asynchronous. A revoke, exposure stop,
			// or caller cancellation can win while the host is awaiting that allocation.
			// Never adapt or publish a late allocation into a cancelled authenticated
			// setup; this boundary owns every native channel until the map is returned
			// successfully to server-core.
			if (context.signal.aborted) {
				closeNativeChannels(nativeChannels, new Set());
				throw (
					context.signal.reason ??
					new DOMException('The operation was aborted', 'AbortError')
				);
			}
			// Validate the native allocation before adapting even one channel. The
			// shared factory also validates the final map, but this privileged
			// boundary owns native cleanup and must not transiently wrap/admit an
			// unexpected lane supplied by a native peer or host opener.
			try {
				validateNativeChannelSet(nativeChannels, context.channels);
			} catch (error) {
				closeNativeChannels(nativeChannels, new Set());
				throw error;
			}
			const channels = new Map<string, HeadlessDataChannel>();
			const seenNativeChannels = new Set<NodeDataChannelLike>();
			// Keep cleanup ownership explicit while adapting a native allocation.
			// A wrapper can already have attempted its native close before the
			// factory rejects the whole map; that channel must not receive a second
			// arbitrary native close, but every other partial allocation still must.
			const nativeCloseAttempted = new Set<NodeDataChannelLike>();
			try {
				for (const [label, nativeChannel] of nativeChannels) {
					if (typeof label !== 'string' || channels.has(label))
						throw new TypeError('node-datachannel channel label is invalid');
					// Each logical traffic lane owns one native channel. Reusing a native
					// object for two labels would let one close/message callback control
					// multiple supposedly isolated server-core channels.
					if (seenNativeChannels.has(nativeChannel))
						throw new TypeError(
							'node-datachannel channel allocation is not isolated',
						);
					seenNativeChannels.add(nativeChannel);
					channels.set(
						label,
						wrapNodeDataChannel(
							nativeChannel,
							label,
							context.maxFrameBytes,
							nativeCloseAttempted,
							context.maxMessageBytes ?? DEFAULT_SCTP_MAX_MESSAGE_BYTES,
						),
					);
				}
			} catch (error) {
				// The factory has not received an adapted channel map yet, so this
				// privileged boundary owns cleanup for any partially validated native
				// allocation. A malformed channel must not leak a native peer until
				// process shutdown or a later reconnect.
				closeNativeChannels(nativeChannels, nativeCloseAttempted);
				throw error;
			}
			return channels as unknown as ReadonlyMap<
				RemoteTrafficChannel,
				HeadlessDataChannel
			>;
		},
	};
}

const TRAFFIC_CHANNELS = new Set<RemoteTrafficChannel>([
	'control',
	'application',
	'terminal',
	'assets',
]);

function validateRequestedChannels(
	channels: readonly RemoteTrafficChannel[],
): void {
	if (!Array.isArray(channels) || channels.length === 0)
		throw new TypeError('node-datachannel channel contract is invalid');
	const requested = new Set<string>();
	for (const label of channels) {
		if (!TRAFFIC_CHANNELS.has(label) || requested.has(label))
			throw new TypeError('node-datachannel channel contract is invalid');
		requested.add(label);
	}
}

function validateNativeChannelSet(
	nativeChannels: ReadonlyMap<string, NodeDataChannelLike>,
	requestedChannels: readonly RemoteTrafficChannel[],
): void {
	if (nativeChannels.size !== requestedChannels.length)
		throw new TypeError(
			'node-datachannel channel allocation does not match the requested contract',
		);
	const requested = new Set<string>(requestedChannels);
	for (const label of nativeChannels.keys()) {
		if (typeof label !== 'string' || !requested.has(label))
			throw new TypeError(
				'node-datachannel channel allocation does not match the requested contract',
			);
	}
}

function validateRuntimeModule(value: unknown): NodeDataChannelRuntimeModule {
	if (
		typeof value !== 'object' ||
		value === null ||
		typeof (value as { readonly PeerConnection?: unknown }).PeerConnection !==
			'function'
	)
		throw new TypeError(
			'node-datachannel runtime does not expose PeerConnection',
		);
	return value as NodeDataChannelRuntimeModule;
}

function wrapNodeDataChannel(
	nativeChannel: NodeDataChannelLike,
	label: string,
	maxFrameBytes: number,
	nativeCloseAttempted: Set<NodeDataChannelLike>,
	maxMessageBytes: number,
): HeadlessDataChannel {
	if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes <= 0)
		throw new TypeError('node-datachannel frame limit is invalid');
	if (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes <= 0)
		throw new TypeError('node-datachannel message limit is invalid');
	if (
		typeof nativeChannel !== 'object' ||
		nativeChannel === null ||
		typeof nativeChannel.getLabel !== 'function' ||
		typeof nativeChannel.isOpen !== 'function' ||
		typeof nativeChannel.bufferedAmount !== 'function' ||
		typeof nativeChannel.sendMessageBinary !== 'function' ||
		typeof nativeChannel.onMessage !== 'function' ||
		typeof nativeChannel.onClosed !== 'function' ||
		typeof nativeChannel.close !== 'function'
	)
		throw new TypeError('node-datachannel channel is invalid');
	// `getLabel()` crosses into the native binding. Do not let a malicious or
	// failing implementation escape this allocation boundary before the caller
	// can close every partially allocated lane.
	try {
		if (nativeChannel.getLabel() !== label)
			throw new TypeError('node-datachannel channel is invalid');
	} catch (error) {
		if (
			error instanceof TypeError &&
			error.message === 'node-datachannel channel is invalid'
		)
			throw error;
		throw new TypeError('node-datachannel channel is invalid');
	}
	// Channel allocation and session admission are separate native operations.
	// A channel which is already closed at this boundary must not be published
	// into a newly authenticated server session: server-core would otherwise
	// receive a superficially valid four-channel map and only discover the
	// failed native allocation later, after admitting the peer.
	try {
		if (nativeChannel.isOpen() !== true)
			throw new TypeError(
				'node-datachannel channel is not open during admission',
			);
	} catch (error) {
		if (error instanceof TypeError) throw error;
		throw new TypeError(
			'node-datachannel channel is not open during admission',
		);
	}
	let closed = false;
	const listeners = new Set<
		(state: 'connecting' | 'open' | 'closing' | 'closed') => void
	>();
	const messageListeners = new Set<(frame: Uint8Array) => void>();
	const notifyState = (
		state: 'connecting' | 'open' | 'closing' | 'closed',
	): void => {
		// These callbacks are server-owned consumers, but they still run from a
		// native lifecycle callback. One faulty observer must not escape back into
		// node-datachannel or prevent the rest of the authenticated-session cleanup.
		for (const listener of [...listeners]) {
			try {
				listener(state);
			} catch {
				/* Lifecycle observers cannot veto native transport cleanup. */
			}
		}
	};
	const finishClosed = (): void => {
		notifyState('closed');
		listeners.clear();
		messageListeners.clear();
	};
	const failClosed = (): void => {
		if (closed) return;
		closed = true;
		notifyState('closing');
		try {
			nativeCloseAttempted.add(nativeChannel);
			nativeChannel.close();
		} catch {
			/* Server-owned session cleanup still runs when native close fails. */
		}
		finishClosed();
	};
	const isNativeChannelOpen = (): boolean => {
		// `isOpen()` is native input as much as the frame itself. A close callback
		// can lag behind a native state transition (and native bindings can throw),
		// so never accept a frame or keep a server session alive based on an
		// unverified native lifecycle state.
		try {
			return nativeChannel.isOpen() === true;
		} catch {
			return false;
		}
	};
	try {
		nativeChannel.onClosed(() => {
			if (closed) return;
			// A native close callback is already the terminal lifecycle transition.
			// Record it in the allocation cleanup set before notifying server-owned
			// observers. If callback registration synchronously reports that close and
			// then throws, the outer partial-allocation cleanup must not call native
			// `close()` a second time on this already-closed channel.
			nativeCloseAttempted.add(nativeChannel);
			closed = true;
			finishClosed();
		});
		nativeChannel.onMessage((message) => {
			if (closed) return;
			if (!isNativeChannelOpen()) {
				failClosed();
				return;
			}
			// The native runtime hands us arbitrary values. Check the size on the
			// original buffer before copying it into the server-owned transport queue:
			// otherwise a malicious peer could force an unbounded allocation before the
			// shared frame validator sees the message.
			const frameLength = byteLengthOf(message);
			if (frameLength === undefined || frameLength > maxFrameBytes) {
				failClosed();
				return;
			}
			const frame = toBytes(message);
			if (frame === undefined) {
				failClosed();
				return;
			}
			// Server-core owns the next boundary, but a handler can still reject a
			// frame synchronously (for example while closing a stale session). Never
			// let that exception escape into the native binding while retaining an
			// authenticated channel: teardown must be deterministic at this edge.
			try {
				for (const listener of [...messageListeners]) listener(frame);
			} catch {
				failClosed();
			}
		});
	} catch {
		// Installing lifecycle callbacks is itself a native boundary. Do not hand
		// server-core a partially observed channel set if a binding refuses either
		// registration; close this channel now and let the adapter close its peers.
		failClosed();
		throw new TypeError('node-datachannel listener registration failed');
	}
	// `isOpen()` above only proves the native state at one instant. A channel can
	// close while its callbacks are being installed (including a synchronous
	// close delivered by a native binding from `onClosed`). Do not return that
	// half-observed channel to server-core: it would let a four-channel session
	// pass allocation before discovering the native loss on its first use.
	if (closed || !isNativeChannelOpen()) {
		if (!closed) failClosed();
		throw new TypeError(
			'node-datachannel channel closed during listener registration',
		);
	}
	return {
		label,
		// Native SCTP rejects a message above this bound, so the transport
		// fragments larger frames rather than losing the lane to one send.
		maxMessageBytes,
		get readyState() {
			if (closed) return 'closed';
			if (isNativeChannelOpen()) return 'open';
			failClosed();
			return 'closed';
		},
		get bufferedAmount() {
			// A native runtime counter is untrusted input at this boundary. Returning
			// an invalid value to server-core would reject the send, but would leave
			// an authenticated native peer and relay subscription alive. Fail closed
			// first so the channel state transition releases that server-owned session.
			try {
				const amount = nativeChannel.bufferedAmount();
				if (Number.isSafeInteger(amount) && amount >= 0) return amount;
			} catch {
				/* Treat a native counter failure exactly like an invalid counter. */
			}
			failClosed();
			return Number.NaN;
		},
		send(frame) {
			if (closed || !isNativeChannelOpen()) {
				if (!closed) failClosed();
				throw new Error('node-datachannel channel is not open');
			}
			// A rejected native write means the authenticated peer no longer has a
			// reliable transport. Do not leave the server-side session and relay
			// subscription alive waiting for a later native close callback.
			try {
				if (nativeChannel.sendMessageBinary(new Uint8Array(frame))) return;
			} catch {
				/* A native send exception has the same lifecycle meaning as rejection. */
			}
			failClosed();
			throw new Error('node-datachannel send was rejected');
		},
		close() {
			if (closed) return;
			closed = true;
			notifyState('closing');
			try {
				nativeChannel.close();
			} catch {
				// Explicit server-owned shutdown must be just as terminal as a
				// native close callback. A binding error cannot escape back through
				// the session cleanup path and leave the other authenticated channels
				// waiting on an operation which has already transitioned closed.
			} finally {
				finishClosed();
			}
		},
		onMessage(listener) {
			messageListeners.add(listener);
			return () => messageListeners.delete(listener);
		},
		onStateChange(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

function toBytes(value: unknown): Uint8Array | undefined {
	if (value instanceof Uint8Array) return new Uint8Array(value);
	if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
	return undefined;
}

function byteLengthOf(value: unknown): number | undefined {
	if (value instanceof Uint8Array || value instanceof ArrayBuffer)
		return value.byteLength;
	return undefined;
}

function closeNativeChannels(
	channels: ReadonlyMap<string, NodeDataChannelLike>,
	nativeCloseAttempted: ReadonlySet<NodeDataChannelLike>,
): void {
	const closed = new Set<NodeDataChannelLike>();
	for (const channel of channels.values()) {
		if (nativeCloseAttempted.has(channel) || closed.has(channel)) continue;
		closed.add(channel);
		try {
			channel.close();
		} catch {
			/* Native cleanup is best effort after a rejected channel set. */
		}
	}
}
