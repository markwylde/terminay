import { randomUUID } from 'node:crypto';
import type { ByteTransport } from '@terminay/protocol';
import type {
	NodeDataChannelSignal,
	NodeDataChannelSignaling,
} from '../../apps/terminay-server/src/remote/nodeDataChannelPeer';
import {
	type DesktopSignalingBootstrap,
	parseDesktopSignalingBootstrap,
} from './desktopSignalingBootstrap';
import {
	createDesktopWebRtcConnection,
	createDesktopWebRtcTransport,
	type DesktopWebRtcConnection,
} from './desktopWebRtcTransport';

const MAX_SEEN_NONCES = 256;
const DEFAULT_SOCKET_OPEN_TIMEOUT_MS = 10_000;
const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;
type Socket = {
	readonly readyState: number;
	close(code?: number, reason?: string): void;
	on(
		event: 'open' | 'close' | 'error' | 'message',
		listener: (...args: unknown[]) => void,
	): void;
	send(data: string): void;
};

export async function createDesktopBootstrappedWebRtcTransport(options: {
	readonly bootstrap: DesktopSignalingBootstrap;
	readonly expectedOrigin: string;
	readonly now?: () => number;
	readonly openSocket?: (url: string, origin: string) => Socket;
	readonly socketOpenTimeoutMs?: number;
	readonly webrtcRuntimeRoot?: string;
	readonly createTransport?: typeof createDesktopWebRtcTransport;
}): Promise<ByteTransport> {
	return (await createDesktopBootstrappedWebRtcConnection({
		...options,
		createConnection: options.createTransport === undefined
			? undefined
			: async (input) => ({ transport: await options.createTransport!(input), assets: unavailableAssetLane, serverId: input.serverId }),
	})).transport;
}

const unavailableAssetLane = Object.freeze({
	getBundle: async (): Promise<never> => { throw new Error('Desktop WebRTC asset lane is unavailable.'); },
});

export async function createDesktopBootstrappedWebRtcConnection(options: {
	readonly bootstrap: DesktopSignalingBootstrap;
	readonly expectedOrigin: string;
	readonly now?: () => number;
	readonly openSocket?: (url: string, origin: string) => Socket;
	readonly socketOpenTimeoutMs?: number;
	/** Packaged directory holding the selected WebRTC runtime and its manifest. */
	readonly webrtcRuntimeRoot?: string;
	readonly createConnection?: typeof createDesktopWebRtcConnection;
}): Promise<DesktopWebRtcConnection> {
	const now = options.now ?? Date.now;
	const bootstrap = parseDesktopSignalingBootstrap(
		options.bootstrap,
		options.expectedOrigin,
		now(),
	);
	const signaling = await openAuthenticatedSignaling(bootstrap, {
		now,
		openSocket: options.openSocket,
		socketOpenTimeoutMs:
			options.socketOpenTimeoutMs ?? DEFAULT_SOCKET_OPEN_TIMEOUT_MS,
	});
	try {
		const connection = await (
			options.createConnection ?? createDesktopWebRtcConnection
		)({
			deviceId: bootstrap.deviceId,
			iceServers: bootstrap.iceServers.map((server) => ({
				urls: [...server.urls],
				...(server.username === undefined ? {} : { username: server.username }),
				...(server.credential === undefined
					? {}
					: { credential: server.credential }),
				...(server.expiresAt === undefined
					? {}
					: { expiresAt: server.expiresAt }),
			})),
			peerId: bootstrap.peerId,
			serverId: bootstrap.serverId,
			sessionOrigin: bootstrap.sessionOrigin,
			signaling,
			...(options.webrtcRuntimeRoot === undefined
				? {}
				: { webrtcRuntimeRoot: options.webrtcRuntimeRoot }),
		});
		connection.transport.onStateChange((state) => {
			if (state === 'closed' || state === 'failed') signaling.close();
		});
		return connection;
	} catch (error) {
		signaling.close();
		throw error;
	}
}

async function openAuthenticatedSignaling(
	bootstrap: DesktopSignalingBootstrap,
	options: {
		readonly now: () => number;
		readonly openSocket?: (url: string, origin: string) => Socket;
		readonly socketOpenTimeoutMs: number;
	},
): Promise<NodeDataChannelSignaling & { close(): void }> {
	if (
		!Number.isSafeInteger(options.socketOpenTimeoutMs) ||
		options.socketOpenTimeoutMs < 1 ||
		options.socketOpenTimeoutMs > 30_000
	)
		throw new RangeError(
			'Desktop WebRTC signaling open timeout must be between 1ms and 30 seconds.',
		);
	const socket =
		options.openSocket?.(bootstrap.signalingUrl, bootstrap.sessionOrigin) ??
		(new (await import('ws')).default(bootstrap.signalingUrl, {
			origin: bootstrap.sessionOrigin,
		}) as unknown as Socket);
	const listeners = new Set<(message: unknown) => void>();
	const seen = new Set<string>();
	let closed = false;
	let terminalError: Error | undefined;
	await new Promise<void>((resolve, reject) => {
		let settled = false;
		const timeout = setTimeout(() => {
			const error = new Error(
				'Desktop WebRTC signaling connection timed out before opening.',
			);
			fail(error);
			if (
				socket.readyState === SOCKET_CONNECTING ||
				socket.readyState === SOCKET_OPEN
			)
				socket.close(1000, 'Desktop WebRTC signaling open timed out');
		}, options.socketOpenTimeoutMs);
		const fail = (error: Error) => {
			terminalError = error;
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			reject(error);
		};
		socket.on('open', () => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			resolve();
		});
		socket.on('error', () =>
			fail(new Error('Desktop WebRTC signaling connection failed.')),
		);
		socket.on('close', () => {
			closed = true;
			const error = new Error('Desktop WebRTC signaling connection closed.');
			fail(error);
			for (const listener of listeners) listener({});
		});
		socket.on('message', (raw) => {
			try {
				const message = JSON.parse(String(raw));
				if (
					typeof message !== 'object' ||
					message === null ||
					Array.isArray(message)
				)
					throw new Error('Desktop WebRTC signaling frame is invalid.');
				for (const listener of listeners) listener(message);
			} catch (error) {
				terminalError =
					error instanceof Error
						? error
						: new Error('Invalid signaling frame.');
				if (socket.readyState === SOCKET_OPEN)
					socket.close(1008, 'Invalid authenticated signaling frame');
			}
		});
	});
	return {
		close() {
			if (closed) return;
			closed = true;
			listeners.clear();
			if (
				socket.readyState === SOCKET_OPEN ||
				socket.readyState === SOCKET_CONNECTING
			)
				socket.close(1000, 'Desktop WebRTC transport closed');
		},
		onMessage(listener) {
			if (terminalError !== undefined) throw terminalError;
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		send(message) {
			if (
				closed ||
				terminalError !== undefined ||
				socket.readyState !== SOCKET_OPEN
			)
				throw terminalError ?? new Error('Desktop WebRTC signaling is closed.');
			if (typeof message !== 'object' || message === null)
				throw new Error('Desktop WebRTC signaling frame is invalid.');
			socket.send(JSON.stringify(message));
		},
		encode: (signal) => encodeEnvelope(signal, bootstrap),
		decode: (message) =>
			decodeEnvelope(message, bootstrap, seen, options.now()),
	};
}

function encodeEnvelope(
	signal: NodeDataChannelSignal,
	bootstrap: DesktopSignalingBootstrap,
): Record<string, unknown> {
	return {
		deviceId: bootstrap.deviceId,
		nonce: randomUUID(),
		peerId: bootstrap.peerId,
		serverId: bootstrap.serverId,
		sessionOrigin: bootstrap.sessionOrigin,
		...signal,
	};
}

function decodeEnvelope(
	value: unknown,
	bootstrap: DesktopSignalingBootstrap,
	seen: Set<string>,
	now: number,
): NodeDataChannelSignal {
	if (now >= bootstrap.expiresAt)
		throw new Error('Desktop WebRTC signaling bootstrap expired.');
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new Error('Desktop WebRTC signaling frame is invalid.');
	const input = value as Record<string, unknown>;
	const allowed =
		input.type === 'offer' || input.type === 'answer'
			? new Set([
					'deviceId',
					'nonce',
					'peerId',
					'sdp',
					'serverId',
					'sessionOrigin',
					'type',
				])
			: input.type === 'ice'
				? new Set([
						'candidate',
						'deviceId',
						'mid',
						'nonce',
						'peerId',
						'serverId',
						'sessionOrigin',
						'type',
					])
				: new Set<string>();
	if (
		allowed.size === 0 ||
		Object.keys(input).length !== allowed.size ||
		Object.keys(input).some((key) => !allowed.has(key))
	)
		throw new Error('Desktop WebRTC signaling frame has invalid fields.');
	const nonce = input.nonce;
	if (
		input.deviceId !== bootstrap.deviceId ||
		input.peerId !== bootstrap.peerId ||
		input.serverId !== bootstrap.serverId ||
		input.sessionOrigin !== bootstrap.sessionOrigin ||
		typeof nonce !== 'string' ||
		nonce.length < 16 ||
		nonce.length > 128
	)
		throw new Error('Desktop WebRTC signaling frame does not match its authenticated relay session.');
	if (seen.has(nonce))
		throw new Error('Desktop WebRTC signaling replay was rejected.');
	if (seen.size >= MAX_SEEN_NONCES)
		throw new Error('Desktop WebRTC signaling replay window is full.');
	seen.add(nonce);
	if (
		(input.type === 'offer' || input.type === 'answer') &&
		typeof input.sdp === 'string'
	)
		return { type: input.type, sdp: input.sdp };
	if (
		input.type === 'ice' &&
		typeof input.candidate === 'string' &&
		typeof input.mid === 'string'
	)
		return { type: 'ice', candidate: input.candidate, mid: input.mid };
	throw new Error('Desktop WebRTC signaling frame is invalid.');
}
