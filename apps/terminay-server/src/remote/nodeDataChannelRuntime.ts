import type {
	HeadlessDataChannel,
	HeadlessWebRtcRuntimeAdapter,
	HeadlessWebRtcRuntimeContext,
	RemoteTrafficChannel,
} from '@terminay/server-core';

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
	/** Injected for tests or a host that already loaded the native module. */
	readonly module?: NodeDataChannelRuntimeModule;
	/** Dynamic loader keeps the optional native dependency out of server-core. */
	readonly loadModule?: () => Promise<NodeDataChannelRuntimeModule>;
	/** Signaling/peer setup remains a server-host concern. */
	readonly openChannels: (
		module: NodeDataChannelRuntimeModule,
		context: HeadlessWebRtcRuntimeContext,
	) => Promise<ReadonlyMap<string, NodeDataChannelLike>> | ReadonlyMap<string, NodeDataChannelLike>;
}

/**
 * Load an optional node-datachannel installation at the privileged server
 * boundary. No native WebRTC package is imported by server-core or shared
 * browser code; an unavailable module fails with a typed setup error.
 */
export async function loadNodeDataChannelRuntimeModule(
	specifier = 'node-datachannel',
): Promise<NodeDataChannelRuntimeModule> {
	if (typeof specifier !== 'string' || specifier.length === 0 || specifier.length > 256)
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
		if (error instanceof TypeError && /PeerConnection|module/i.test(error.message)) throw error;
		throw new Error('node-datachannel runtime is unavailable', { cause: error });
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
		throw new TypeError('node-datachannel module and loader are mutually exclusive');
	let loadedModule: Promise<NodeDataChannelRuntimeModule> | undefined;
	const resolveModule = (): Promise<NodeDataChannelRuntimeModule> => {
		if (options.module !== undefined) return Promise.resolve(validateRuntimeModule(options.module));
		if (loadedModule === undefined) {
			loadedModule = Promise.resolve(options.loadModule?.()).then((module) => validateRuntimeModule(module));
		}
		return loadedModule;
	};
	return {
		runtime: 'node-datachannel',
		async connect(context) {
			const module = await resolveModule();
			const nativeChannels = await options.openChannels(module, context);
			if (!(nativeChannels instanceof Map))
				throw new TypeError('node-datachannel channel set is invalid');
			const channels = new Map<string, HeadlessDataChannel>();
			for (const [label, nativeChannel] of nativeChannels) {
				if (typeof label !== 'string' || channels.has(label))
					throw new TypeError('node-datachannel channel label is invalid');
				channels.set(label, wrapNodeDataChannel(nativeChannel, label));
			}
			return channels as unknown as ReadonlyMap<RemoteTrafficChannel, HeadlessDataChannel>;
		},
	};
}

function validateRuntimeModule(value: unknown): NodeDataChannelRuntimeModule {
	if (typeof value !== 'object' || value === null || typeof (value as { readonly PeerConnection?: unknown }).PeerConnection !== 'function')
		throw new TypeError('node-datachannel runtime does not expose PeerConnection');
	return value as NodeDataChannelRuntimeModule;
}

function wrapNodeDataChannel(nativeChannel: NodeDataChannelLike, label: string): HeadlessDataChannel {
	if (
		typeof nativeChannel !== 'object' ||
		nativeChannel === null ||
		typeof nativeChannel.getLabel !== 'function' ||
		nativeChannel.getLabel() !== label ||
		typeof nativeChannel.isOpen !== 'function' ||
		typeof nativeChannel.bufferedAmount !== 'function' ||
		typeof nativeChannel.sendMessageBinary !== 'function' ||
		typeof nativeChannel.onMessage !== 'function' ||
		typeof nativeChannel.onClosed !== 'function' ||
		typeof nativeChannel.close !== 'function'
	)
		throw new TypeError('node-datachannel channel is invalid');
	let closed = false;
	const listeners = new Set<(state: 'connecting' | 'open' | 'closing' | 'closed') => void>();
	const messageListeners = new Set<(frame: Uint8Array) => void>();
	nativeChannel.onClosed(() => {
		if (closed) return;
		closed = true;
		for (const listener of [...listeners]) listener('closed');
		listeners.clear();
	});
	nativeChannel.onMessage((message) => {
		if (closed) return;
		const frame = toBytes(message);
		if (frame === undefined) {
			closed = true;
			for (const listener of [...listeners]) listener('closing');
			try {
				nativeChannel.close();
			} catch {
				/* The server session still tears down its peer if native close fails. */
			}
			for (const listener of [...listeners]) listener('closed');
			listeners.clear();
			return;
		}
		for (const listener of [...messageListeners]) listener(frame);
	});
	return {
		label,
		get readyState() {
			if (closed) return 'closed';
			return nativeChannel.isOpen() ? 'open' : 'connecting';
		},
		get bufferedAmount() {
			return nativeChannel.bufferedAmount();
		},
		send(frame) {
			if (closed || !nativeChannel.isOpen()) throw new Error('node-datachannel channel is not open');
			if (!nativeChannel.sendMessageBinary(new Uint8Array(frame)))
				throw new Error('node-datachannel send was rejected');
		},
		close() {
			if (closed) return;
			closed = true;
			for (const listener of [...listeners]) listener('closing');
			nativeChannel.close();
			for (const listener of [...listeners]) listener('closed');
			listeners.clear();
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
