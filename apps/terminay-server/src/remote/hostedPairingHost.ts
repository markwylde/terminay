import { gzipSync } from 'node:zlib';
import { timingSafeEqual } from 'node:crypto';
import { WebSocket } from 'ws';
import type { ByteTransport } from '@terminay/protocol';
import type {
	AuthenticatedClient,
	ServerConnectionLike,
} from '@terminay/server-core';
import { HeadlessChannelTransport, type HeadlessDataChannel } from '@terminay/server-core/remote';
import { loadSelectedSecureWeriftRuntime } from './secureWeriftRuntime.js';
import {
	createDeviceHostReadyMessage,
	type HostedHostKey,
} from './hostedHostKey.js';
import {
	deriveHostedPairingSecrets,
	hostedSessionId,
	hostedSignalingUrl,
} from './hostedPairingSecrets.js';
import type { ServerPairingHandoff, ServerRemoteExposure } from './serverExposure.js';
import { bindUiArchiveChannels, safeChannelSend } from './uiArchiveTransfer.js';

const CHANNELS = ['api', 'asset', 'control', 'application', 'terminal', 'assets'] as const;

type WeriftIceCandidate = Readonly<{
	candidate?: string;
	sdpMLineIndex?: number | null;
	sdpMid?: string | null;
	toJSON?: () => WeriftIceCandidate;
}>;
type WeriftPeer = {
	readonly localDescription: Readonly<{ sdp?: string; type?: string }> | null | undefined;
	addEventListener(type: string, listener: (event: Record<string, unknown>) => void): void;
	addIceCandidate(candidate: Readonly<{ candidate: string; sdpMid: string }>): Promise<void>;
	close(): void;
	createDataChannel(
		label: string,
		options?: { readonly ordered?: boolean },
	): WeriftDataChannel;
	createOffer(): Promise<Readonly<{ sdp?: string; type?: string }>>;
	setLocalDescription(description: Readonly<{ sdp?: string; type?: string }>): Promise<void>;
	setRemoteDescription(description: Readonly<{ sdp: string; type: string }>): Promise<void>;
};
type WeriftDataChannel = {
	readonly bufferedAmount?: number;
	readonly label?: string;
	readonly readyState: string;
	addEventListener(type: string, listener: (event: Record<string, unknown>) => void): void;
	close?(): void;
	removeEventListener(type: string, listener: (event: Record<string, unknown>) => void): void;
	send(data: string | Uint8Array): void;
};

export type MinimalArchive = Readonly<{ bundleId: string; bytes: Uint8Array }>;

export interface HostedPairingHostOptions {
	readonly acceptApplication?: (
		transport: ByteTransport,
		client: AuthenticatedClient,
	) => ServerConnectionLike;
	readonly getUiArchive?: () => Promise<MinimalArchive> | MinimalArchive;
	readonly handoff: ServerPairingHandoff;
	readonly hostKey: HostedHostKey;
	readonly persistDevices: (devices: ReturnType<ServerRemoteExposure['devices']['list']>) => void;
	readonly pin?: string;
	readonly remote: ServerRemoteExposure;
	readonly serverId: string;
	readonly signal?: Readonly<{
		readonly connectHost?: string;
		readonly insecureTls?: boolean;
	}>;
	readonly verifyPairingPin?: (pin: string) => boolean;
	readonly webrtcRuntimeRoot: string;
	readonly rotateHandoff?: () => ServerPairingHandoff;
	readonly onHandoff?: (handoff: ServerPairingHandoff) => void;
	readonly onPeerConnected?: () => void;
	readonly onDiagnostic?: (event: HostedPairingDiagnostic) => void;
}

export type HostedPairingDiagnostic = Readonly<{
	readonly type:
		| 'advertised'
		| 'registered'
		| 'signaling-closed'
		| 'rotated'
		| 'reregistered'
		| 'client-join'
		| 'failed';
	readonly scope?: 'pairing' | 'device';
	readonly advertisedUrlClass?: 'manager' | 'session' | 'loopback' | 'other';
	readonly signalingHostClass?: 'terminay-session' | 'loopback' | 'other';
	readonly closeCode?: number;
	readonly closeReasonClass?: string;
	readonly remainingMs?: number;
	readonly cause?: string;
}>;

export interface HostedPairingHost {
	readonly close: () => Promise<void>;
}

const DEVICE_HOST_AVAILABILITY_MS = 25 * 60 * 1000;
const DEVICE_REFRESH_LEAD_MS = 5 * 60 * 1000;
const PAIRING_REFRESH_LEAD_MS = 15_000;
const REFRESH_RETRY_MS = 2_000;
const INITIAL_REGISTER_TIMEOUT_MS = 10_000;

export async function startHostedPairingHost(
	options: HostedPairingHostOptions,
): Promise<HostedPairingHost> {
	const sessionId = hostedSessionId(options.handoff.sessionOrigin);
	const signalingUrl = hostedSignalingUrl(options.handoff.sessionOrigin);
	const signalingHostClass = classifySignalingHost(options.handoff.sessionOrigin);
	const runtime = await loadSelectedSecureWeriftRuntime(options.webrtcRuntimeRoot);
	const Peer = runtime.RTCPeerConnection as unknown as new (
		configuration?: Record<string, unknown>,
	) => WeriftPeer;
	const archive = options.getUiArchive
		? await options.getUiArchive()
		: createMinimalUiArchive();
	const context = { archive, options };
	const connectedPeers: WeriftPeer[] = [];
	const connectedConnections: ServerConnectionLike[] = [];
	let handshakePeer: WeriftPeer | undefined;
	let pairingSocket: WebSocket | undefined;
	let deviceSocket: WebSocket | undefined;
	let pairingGeneration = 0;
	let deviceGeneration = 0;
	let pairingRefreshTimer: ReturnType<typeof setTimeout> | undefined;
	let deviceRefreshTimer: ReturnType<typeof setTimeout> | undefined;
	let pairingReady = false;
	let deviceReady = false;
	let currentHandoff = options.handoff;
	let closed = false;
	let deviceExpiresAt = Date.now() + DEVICE_HOST_AVAILABILITY_MS;

	const diagnose = (event: HostedPairingDiagnostic) => {
		options.onDiagnostic?.(event);
	};

	const close = async () => {
		if (closed) return;
		closed = true;
		clearTimeout(pairingRefreshTimer);
		clearTimeout(deviceRefreshTimer);
		handshakePeer?.close();
		for (const peer of connectedPeers) peer.close();
		for (const connection of connectedConnections) void connection.close();
		pairingGeneration += 1;
		deviceGeneration += 1;
		closeSocket(pairingSocket);
		closeSocket(deviceSocket);
	};

	async function addHandshakePeer(socket: WebSocket, scope: SignalScope): Promise<void> {
		if (handshakePeer && !connectedPeers.includes(handshakePeer)) {
			handshakePeer.close();
		}
		const next = await startPeer(Peer, socket, scope, context, (connection) => {
			connectedConnections.push(connection);
			if (handshakePeer === next) {
				connectedPeers.push(next);
				handshakePeer = undefined;
			}
			options.onPeerConnected?.();
		});
		handshakePeer = next;
	}

	async function handlePairingSignal(
		message: Record<string, unknown> | undefined,
		derived: ReturnType<typeof deriveHostedPairingSecrets>,
		socket: WebSocket,
		registered: ReturnType<typeof waitForSignalType>,
	): Promise<void> {
		if (!message || registered.handle(message)) return;
		if (message.type === 'client-join') {
			diagnose({ type: 'client-join', scope: 'pairing' });
			await addHandshakePeer(socket, { kind: 'pairing', roomId: derived.pairingRoomId });
			return;
		}
		if (message.type === 'answer' && handshakePeer) {
			const description = asSessionDescription(message.sdp);
			if (description) await handshakePeer.setRemoteDescription(description);
			return;
		}
		if (message.type === 'ice' && handshakePeer) {
			const candidate = asIceCandidate(message.candidate);
			if (candidate) await handshakePeer.addIceCandidate(candidate);
		}
	}

	async function handleDeviceSignal(
		message: Record<string, unknown> | undefined,
		socket: WebSocket,
		registered: ReturnType<typeof waitForSignalType>,
	): Promise<void> {
		if (!message || registered.handle(message)) return;
		if (message.type === 'device-join') {
			diagnose({ type: 'client-join', scope: 'device' });
			await addHandshakePeer(socket, { kind: 'device', sessionId });
			return;
		}
		if (message.type === 'device-answer' && handshakePeer) {
			const description = asSessionDescription(message.sdp);
			if (description) await handshakePeer.setRemoteDescription(description);
			return;
		}
		if (message.type === 'device-ice' && handshakePeer) {
			const candidate = asIceCandidate(message.candidate);
			if (candidate) await handshakePeer.addIceCandidate(candidate);
		}
	}

	async function registerPairing(handoff: ServerPairingHandoff): Promise<void> {
		const generation = ++pairingGeneration;
		pairingReady = false;
		const derived = deriveHostedPairingSecrets(new URL(handoff.pairingUrl).hash.slice(1));
		const socket = openSignalSocket(signalingUrl, handoff.sessionOrigin, options.signal);
		pairingSocket = socket;
		const registered = waitForSignalType(socket, 'host-registered');
		socket.on('message', (raw) => {
			if (generation !== pairingGeneration) return;
			void handlePairingSignal(parseSignal(raw), derived, socket, registered).catch(logHostError);
		});
		socket.once('close', (code, reason) => {
			if (closed || generation !== pairingGeneration || !pairingReady) return;
			diagnose({
				type: 'signaling-closed',
				scope: 'pairing',
				closeReasonClass: closeReasonClass(reason),
				signalingHostClass,
				...(typeof code === 'number' ? { closeCode: code } : {}),
			});
			void refreshPairing('socket-closed');
		});
		try {
			await waitForOpen(socket);
			if (closed || generation !== pairingGeneration) {
				void registered.promise.catch(() => undefined);
				return;
			}
			socket.send(
				JSON.stringify({
					expiresAt: handoff.pairingExpiresAt,
					relayJoinTokenHash: derived.relayJoinTokenHash,
					roomId: derived.pairingRoomId,
					type: 'host-ready',
				}),
			);
			await registered.promise;
		} catch (error) {
			void registered.promise.catch(() => undefined);
			throw error;
		}
		if (closed || generation !== pairingGeneration) return;
		pairingReady = true;
		diagnose({
			type: 'registered',
			scope: 'pairing',
			advertisedUrlClass: advertisedUrlClass(handoff.pairingUrl),
			signalingHostClass,
		});
		schedulePairingRefresh(handoff);
	}

	async function registerDevice(): Promise<void> {
		const generation = ++deviceGeneration;
		deviceReady = false;
		const socket = openSignalSocket(
			signalingUrl,
			options.handoff.sessionOrigin,
			options.signal,
		);
		deviceSocket = socket;
		const registered = waitForSignalType(socket, 'device-host-registered');
		socket.on('message', (raw) => {
			if (generation !== deviceGeneration) return;
			void handleDeviceSignal(parseSignal(raw), socket, registered).catch(logHostError);
		});
		socket.once('close', (code, reason) => {
			if (closed || generation !== deviceGeneration || !deviceReady) return;
			diagnose({
				type: 'signaling-closed',
				scope: 'device',
				closeReasonClass: closeReasonClass(reason),
				signalingHostClass,
				...(typeof code === 'number' ? { closeCode: code } : {}),
			});
			void refreshDevice('socket-closed');
		});
		try {
			await waitForOpen(socket);
			if (closed || generation !== deviceGeneration) {
				void registered.promise.catch(() => undefined);
				return;
			}
			deviceExpiresAt = Date.now() + DEVICE_HOST_AVAILABILITY_MS;
			socket.send(
				JSON.stringify(
					createDeviceHostReadyMessage({
						expiresAt: new Date(deviceExpiresAt).toISOString(),
						hostKey: options.hostKey,
						sessionId,
					}),
				),
			);
			await registered.promise;
		} catch (error) {
			void registered.promise.catch(() => undefined);
			throw error;
		}
		if (closed || generation !== deviceGeneration) return;
		deviceReady = true;
		diagnose({ type: 'registered', scope: 'device', signalingHostClass });
		scheduleDeviceRefresh();
	}

	async function refreshPairing(cause: string): Promise<void> {
		if (closed) return;
		const remaining = Date.parse(currentHandoff.pairingExpiresAt) - Date.now();
		const shouldRotate =
			Boolean(options.rotateHandoff) && !(remaining > PAIRING_REFRESH_LEAD_MS);
		try {
			if (shouldRotate && options.rotateHandoff) {
				currentHandoff = options.rotateHandoff();
				options.onHandoff?.(currentHandoff);
				diagnose({
					type: 'rotated',
					cause,
					advertisedUrlClass: advertisedUrlClass(currentHandoff.pairingUrl),
					remainingMs: Date.parse(currentHandoff.pairingExpiresAt) - Date.now(),
				});
			} else {
				diagnose({ type: 'reregistered', scope: 'pairing', cause, remainingMs: remaining });
			}
			const previous = pairingSocket;
			pairingGeneration += 1;
			closeSocket(previous);
			await registerPairing(currentHandoff);
		} catch (error) {
			diagnose({
				type: 'failed',
				scope: 'pairing',
				cause,
			});
			logHostError(error);
			if (!closed) {
				pairingRefreshTimer = setTimeout(() => {
					void refreshPairing('retry');
				}, REFRESH_RETRY_MS);
				pairingRefreshTimer.unref?.();
			}
		}
	}

	async function refreshDevice(cause: string): Promise<void> {
		if (closed) return;
		try {
			diagnose({ type: 'reregistered', scope: 'device', cause });
			const previous = deviceSocket;
			deviceGeneration += 1;
			closeSocket(previous);
			await registerDevice();
		} catch (error) {
			diagnose({ type: 'failed', scope: 'device', cause });
			logHostError(error);
			if (!closed) {
				deviceRefreshTimer = setTimeout(() => {
					void refreshDevice('retry');
				}, REFRESH_RETRY_MS);
				deviceRefreshTimer.unref?.();
			}
		}
	}

	function schedulePairingRefresh(handoff: ServerPairingHandoff): void {
		clearTimeout(pairingRefreshTimer);
		const delay = Math.max(
			1_000,
			Date.parse(handoff.pairingExpiresAt) - Date.now() - PAIRING_REFRESH_LEAD_MS,
		);
		pairingRefreshTimer = setTimeout(() => {
			void refreshPairing('expiry');
		}, delay);
		pairingRefreshTimer.unref?.();
	}

	function scheduleDeviceRefresh(): void {
		clearTimeout(deviceRefreshTimer);
		const delay = Math.max(1_000, deviceExpiresAt - Date.now() - DEVICE_REFRESH_LEAD_MS);
		deviceRefreshTimer = setTimeout(() => {
			void refreshDevice('expiry');
		}, delay);
		deviceRefreshTimer.unref?.();
	}

	diagnose({
		type: 'advertised',
		advertisedUrlClass: advertisedUrlClass(currentHandoff.pairingUrl),
		signalingHostClass,
		remainingMs: Date.parse(currentHandoff.pairingExpiresAt) - Date.now(),
	});

	let registrationTimeout: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			Promise.all([registerPairing(currentHandoff), registerDevice()]).finally(() => {
				clearTimeout(registrationTimeout);
			}),
			new Promise<never>((_, reject) => {
				registrationTimeout = setTimeout(() => {
					reject(new Error('Hosted signaling room registration timed out.'));
				}, INITIAL_REGISTER_TIMEOUT_MS);
			}),
		]);
	} catch (error) {
		diagnose({
			type: 'failed',
			signalingHostClass,
			cause: error instanceof Error ? error.message : 'unknown',
		});
		await close();
		throw error;
	}

	return { close };

	function logHostError(error: unknown): void {
		if (!closed) console.error(error instanceof Error ? error.message : error);
	}
}

function openSignalSocket(
	signalingUrl: string,
	origin: string,
	signal: HostedPairingHostOptions['signal'],
): WebSocket {
	const url = new URL(signalingUrl);
	const connectUrl = signal?.connectHost
		? `${url.protocol}//${formatConnectHost(signal.connectHost, url.port)}${url.pathname}`
		: signalingUrl;
	const socketOptions: WebSocket.ClientOptions & { servername?: string } = {
		headers: { Host: url.host },
		origin,
		servername: url.hostname,
	};
	if (signal?.insecureTls === true) socketOptions.rejectUnauthorized = false;
	const socket = new WebSocket(connectUrl, socketOptions);
	socket.on('error', () => undefined);
	return socket;
}

function closeSocket(socket: WebSocket | undefined): void {
	if (!socket) return;
	if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
		socket.close(1000, 'Terminay pairing host stopped');
	}
}

function parseSignal(raw: unknown): Record<string, unknown> | undefined {
	try {
		return JSON.parse(String(raw)) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

function waitForSignalType(
	socket: WebSocket,
	type: 'host-registered' | 'device-host-registered',
): {
	readonly handle: (message: Record<string, unknown>) => boolean;
	readonly promise: Promise<void>;
} {
	let settled = false;
	let resolve: (() => void) | undefined;
	let reject: ((error: Error) => void) | undefined;
	const promise = new Promise<void>((nextResolve, nextReject) => {
		resolve = nextResolve;
		reject = nextReject;
	});
	const fail = (error: Error) => {
		if (settled) return;
		settled = true;
		reject?.(error);
	};
	socket.once('error', () => fail(new Error('Hosted signaling room registration failed.')));
	socket.once('close', () =>
		fail(new Error('Hosted signaling closed before the room registered.')),
	);
	return {
		promise,
		handle(message) {
			if (message.type === 'error') {
				fail(
					new Error(
						typeof message.message === 'string'
							? message.message
							: 'Hosted signaling rejected room registration.',
					),
				);
				return true;
			}
			if (message.type !== type) return false;
			if (!settled) {
				settled = true;
				resolve?.();
			}
			return true;
		},
	};
}

type SignalScope =
	| { readonly kind: 'pairing'; readonly roomId: string }
	| { readonly kind: 'device'; readonly sessionId: string };

function hostedPeerConfiguration(connectHost: string | undefined): Record<string, unknown> {
	const loopback =
		connectHost === '127.0.0.1' || connectHost === 'localhost' || connectHost === '::1';
	return {
		iceServers: [],
		maxMessageSize: 1024 * 1024,
		...(loopback
			? {
					iceAdditionalHostAddresses: ['127.0.0.1'],
					iceInterfaceAddresses: { udp4: '127.0.0.1' },
					iceUseIpv4: false,
					iceUseIpv6: false,
				}
			: {}),
	};
}

function formatConnectHost(host: string, port: string): string {
	return port ? `${host}:${port}` : host;
}

function waitForOpen(socket: WebSocket): Promise<void> {
	if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
	if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) {
		return Promise.reject(new Error('Hosted signaling could not connect.'));
	}
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			socket.off('open', onOpen);
			socket.off('error', onFail);
			socket.off('close', onFail);
			if (error) reject(error);
			else resolve();
		};
		const onOpen = () => finish();
		const onFail = () => finish(new Error('Hosted signaling could not connect.'));
		socket.once('open', onOpen);
		socket.once('error', onFail);
		socket.once('close', onFail);
	});
}

function advertisedUrlClass(pairingUrl: string): 'manager' | 'session' | 'loopback' | 'other' {
	try {
		const host = new URL(pairingUrl).hostname.toLowerCase();
		if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return 'loopback';
		if (host === 'app.terminay.com') return 'manager';
		if (host.endsWith('.terminay.com')) return 'session';
		return 'other';
	} catch {
		return 'other';
	}
}

function classifySignalingHost(sessionOrigin: string): 'terminay-session' | 'loopback' | 'other' {
	try {
		const host = new URL(sessionOrigin).hostname.toLowerCase();
		if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost')) {
			return 'loopback';
		}
		if (host.endsWith('.terminay.com') && host !== 'app.terminay.com') return 'terminay-session';
		return 'other';
	} catch {
		return 'other';
	}
}

function closeReasonClass(reason: unknown): string {
	const text = (
		typeof reason === 'string'
			? reason
			: Buffer.isBuffer(reason)
				? reason.toString('utf8')
				: String(reason ?? '')
	).toLowerCase();
	if (text.includes('expired')) return 'expired';
	if (text.includes('complete')) return 'complete';
	if (text.includes('stopped')) return 'host-stopped';
	if (!text.trim()) return 'empty';
	return 'other';
}

async function startPeer(
	Peer: new (configuration?: Record<string, unknown>) => WeriftPeer,
	socket: WebSocket,
	scope: SignalScope,
	context: Readonly<{
		archive: MinimalArchive;
		options: HostedPairingHostOptions;
	}>,
	onApplication: (connection: ServerConnectionLike) => void,
): Promise<WeriftPeer> {
	const native = new Peer(hostedPeerConfiguration(context.options.signal?.connectHost));
	const peer = wrapPeer(native);
	const channels = Object.fromEntries(
		CHANNELS.map((label) => [label, peer.createDataChannel(label, { ordered: true })]),
	) as Record<(typeof CHANNELS)[number], WeriftDataChannel>;

	peer.addEventListener('icecandidate', (event) => {
		const candidate = asIceCandidate(event.candidate);
		if (!candidate || socket.readyState !== WebSocket.OPEN) return;
		socket.send(JSON.stringify(signalMessage(scope, 'ice', { candidate })));
	});
	bindApi(channels.api!, context);
	bindControl(channels.control!, channels.application!, context, onApplication);
	bindUiArchiveChannels([channels.asset!, channels.assets!], context.archive);

	const offer = await peer.createOffer();
	await peer.setLocalDescription(offer);
	const local = peer.localDescription;
	if (typeof local?.sdp !== 'string' || typeof local.type !== 'string') {
		throw new Error('Hosted pairing host could not create a WebRTC offer.');
	}
	socket.send(
		JSON.stringify(signalMessage(scope, 'offer', { sdp: { sdp: local.sdp, type: local.type } })),
	);
	return peer;
}

function signalMessage(
	scope: SignalScope,
	kind: 'offer' | 'ice',
	extra: Record<string, unknown>,
): Record<string, unknown> {
	if (scope.kind === 'pairing') {
		return {
			...extra,
			roomId: scope.roomId,
			type: kind === 'offer' ? 'offer' : 'ice',
		};
	}
	return {
		...extra,
		sessionId: scope.sessionId,
		type: kind === 'offer' ? 'device-offer' : 'device-ice',
	};
}

function wrapPeer(peer: WeriftPeer): WeriftPeer {
	const queued: Array<() => void> = [];
	let remoteSet = false;
	return {
		get localDescription() {
			return peer.localDescription;
		},
		addEventListener(type, listener) {
			if (type !== 'icecandidate') {
				peer.addEventListener(type, listener);
				return;
			}
			peer.addEventListener('icecandidate', (event) => {
				const deliver = () => listener(event);
				if (remoteSet) deliver();
				else queued.push(deliver);
			});
		},
		addIceCandidate: (candidate) => peer.addIceCandidate(candidate),
		close: () => peer.close(),
		createDataChannel: (label, options) => peer.createDataChannel(label, options),
		createOffer: () => peer.createOffer(),
		setLocalDescription: (description) => peer.setLocalDescription(description),
		async setRemoteDescription(description) {
			await peer.setRemoteDescription(description);
			remoteSet = true;
			for (const deliver of queued.splice(0)) deliver();
		},
	};
}

function asSessionDescription(
	value: unknown,
): { sdp: string; type: string } | undefined {
	if (!value || typeof value !== 'object') return undefined;
	const record = value as Record<string, unknown>;
	if (typeof record.sdp !== 'string' || typeof record.type !== 'string') return undefined;
	return { sdp: record.sdp, type: record.type };
}

function asIceCandidate(
	value: unknown,
): { candidate: string; sdpMid: string } | undefined {
	if (!value || typeof value !== 'object') return undefined;
	const record = (
		typeof (value as WeriftIceCandidate).toJSON === 'function'
			? (value as WeriftIceCandidate).toJSON!()
			: value
	) as Record<string, unknown>;
	if (typeof record.candidate !== 'string' || record.candidate.length === 0) return undefined;
	const sdpMid =
		typeof record.sdpMid === 'string' && record.sdpMid.length > 0
			? record.sdpMid
			: typeof record.sdpMLineIndex === 'number'
				? String(record.sdpMLineIndex)
				: undefined;
	return sdpMid === undefined ? undefined : { candidate: record.candidate, sdpMid };
}

function bindApi(
	channel: WeriftDataChannel,
	context: Readonly<{
		archive: MinimalArchive;
		options: HostedPairingHostOptions;
	}>,
): void {
	channel.addEventListener('message', (event) => {
		void (async () => {
			let request: Record<string, unknown>;
			try {
				request = JSON.parse(String(event.data ?? '')) as Record<string, unknown>;
			} catch {
				return;
			}
			if (request.type !== 'api-request' || typeof request.id !== 'string') return;
			try {
				const body = await handleApi(request.pathname, request.body, context);
				safeChannelSend(channel, JSON.stringify({ body, id: request.id, ok: true, type: 'api-response' }));
			} catch (error) {
				safeChannelSend(
					channel,
					JSON.stringify({
						error: error instanceof Error ? error.message : 'Terminay rejected the bootstrap request.',
						id: request.id,
						ok: false,
						type: 'api-response',
					}),
				);
			}
		})().catch((error) => {
			console.error(error instanceof Error ? error.message : error);
		});
	});
}

async function handleApi(
	pathname: unknown,
	body: unknown,
	context: Readonly<{
		archive: MinimalArchive;
		options: HostedPairingHostOptions;
	}>,
): Promise<unknown> {
	const request = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
	if (pathname === '/api/host-context') {
		const sessionId =
			new URL(context.options.handoff.sessionOrigin).hostname.split('.')[0] ?? 'session';
		return {
			applicationProtocolVersion: '1',
			bootstrapVersion: 1,
			bundleId: context.archive.bundleId,
			byteEndpointVersion: 1,
			capabilities: { clipboardWrite: 1, notifications: 1 },
			hostBridgeVersion: 1,
			hostKind: 'browser',
			profileId: context.options.serverId,
			schemaVersion: 1,
			serverId: context.options.serverId,
			sourceId: `browser-${sessionId}`,
			windowId: `browser-${sessionId}`,
		};
	}
	if (pathname === '/api/devices/enroll') {
		if (!pairingPinMatches(String(request.pairingPin ?? ''), context.options)) {
			throw new Error('pairing authority is invalid');
		}
		const device = context.options.remote.enrollDevice({
			deviceName: String(request.deviceName ?? 'Browser'),
			pairingSessionId: String(request.pairingSessionId ?? ''),
			pairingToken: String(request.pairingToken ?? ''),
			publicKeyPem: String(request.publicKeyPem ?? ''),
		});
		context.options.persistDevices(context.options.remote.devices.list());
		const ticket = context.options.remote.issueConnectionTicket(device.deviceId);
		return { deviceId: device.deviceId, deviceName: device.deviceName, ticket: ticket.ticket };
	}
	if (pathname === '/api/devices/challenge') {
		const pending = context.options.remote.createDeviceChallenge(String(request.deviceId ?? ''));
		return {
			challenge: {
				deviceId: pending.challenge.deviceId,
				expiry: new Date(pending.challenge.expiresAt).toISOString(),
				nonce: pending.challenge.nonce,
				origin: pending.challenge.sessionOrigin,
				serverId: pending.challenge.serverId,
			},
			challengeId: pending.challenge.challengeId,
			signingInput: pending.signingInput,
		};
	}
	if (pathname === '/api/devices/verify') {
		const ticket = context.options.remote.verifyDeviceSignature({
			challengeId: String(request.challengeId ?? ''),
			deviceId: String(request.deviceId ?? ''),
			deviceSignature: String(request.deviceSignature ?? ''),
		});
		return { ticket: ticket.ticket };
	}
	throw new Error('Not found');
}

function bindControl(
	channel: WeriftDataChannel,
	application: WeriftDataChannel,
	context: Readonly<{ options: HostedPairingHostOptions }>,
	onApplication: (connection: ServerConnectionLike) => void,
): void {
	channel.addEventListener('message', (event) => {
		let request: Record<string, unknown>;
		try {
			request = JSON.parse(String(event.data ?? '')) as Record<string, unknown>;
		} catch {
			return;
		}
		if (request.type !== 'application-auth' || typeof request.id !== 'string') return;
		let ticket: ReturnType<ServerRemoteExposure['consumeConnectionTicket']> | undefined;
		try {
			ticket = context.options.remote.consumeConnectionTicket(String(request.ticket ?? ''));
		} catch {
			ticket = undefined;
		}
		const ok = ticket !== undefined;
		try {
			safeChannelSend(
				channel,
				JSON.stringify({
					error: ok ? undefined : 'Terminay rejected the workspace.',
					id: request.id,
					ok,
					type: 'application-authenticated',
				}),
			);
		} catch (error) {
			console.error(error instanceof Error ? error.message : error);
			return;
		}
		if (!ok || !ticket || context.options.acceptApplication === undefined) return;
		try {
			const connection = context.options.acceptApplication(
				new HeadlessChannelTransport(asHeadlessChannel(application)),
				{
					authScope: 'admin',
					clientId: ticket.deviceId,
					permissions: [
						'environments:read',
						'environments:manage',
						'workspace:write',
						'extensions:read',
						'extensions:manage',
					],
				},
			);
			onApplication(connection);
			void connection.start().catch((error) => {
				console.error(error instanceof Error ? error.message : error);
				void connection.close();
			});
		} catch (error) {
			console.error(error instanceof Error ? error.message : error);
		}
	});
}

function pairingPinMatches(received: string, options: HostedPairingHostOptions): boolean {
	if (options.verifyPairingPin) return options.verifyPairingPin(received);
	const expected = options.pin ?? '';
	if (!/^\d{6}$/u.test(received) || !/^\d{6}$/u.test(expected)) return false;
	return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

function asHeadlessChannel(channel: WeriftDataChannel): HeadlessDataChannel {
	const listeners = new Set<(state: HeadlessDataChannel['readyState']) => void>();
	const emit = () => {
		const state = mapChannelState(channel.readyState);
		for (const listener of listeners) listener(state);
	};
	channel.addEventListener('open', emit);
	channel.addEventListener('close', emit);
	channel.addEventListener('error', emit);
	return {
		get label() {
			return channel.label ?? 'application';
		},
		get readyState() {
			return mapChannelState(channel.readyState);
		},
		get bufferedAmount() {
			return typeof channel.bufferedAmount === 'number' ? channel.bufferedAmount : 0;
		},
		send(frame) {
			safeChannelSend(channel, frame);
		},
		close() {
			channel.close?.();
		},
		onMessage(listener) {
			const handler = (event: Record<string, unknown>) => {
				const value = event.data;
				const frame =
					value instanceof ArrayBuffer
						? new Uint8Array(value)
						: ArrayBuffer.isView(value)
							? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
							: value instanceof Uint8Array
								? value
								: undefined;
				if (frame) listener(frame);
			};
			channel.addEventListener('message', handler);
			return () => channel.removeEventListener('message', handler);
		},
		onStateChange(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

function mapChannelState(state: string): HeadlessDataChannel['readyState'] {
	if (state === 'open') return 'open';
	if (state === 'connecting') return 'connecting';
	if (state === 'closing') return 'closing';
	return 'closed';
}

function createMinimalUiArchive(): MinimalArchive {
	const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Terminay</title></head><body><main id="terminay-workspace">Terminay workspace is connected.</main></body></html>`;
	const metadata = JSON.stringify({
		archiveFormatVersion: 1,
		bundleId: 'standalonehostedui',
		entryPath: 'workspace.html',
	});
	return Object.freeze({
		bundleId: 'standalonehostedui',
		bytes: gzipSync(makeTar([
			['terminay-bundle.json', metadata],
			['workspace.html', html],
		])),
	});
}

function makeTar(entries: ReadonlyArray<readonly [string, string]>): Uint8Array {
	const encoder = new TextEncoder();
	const blocks: Uint8Array[] = [];
	for (const [name, bodyText] of entries) {
		const body = encoder.encode(bodyText);
		const header = new Uint8Array(512);
		writeTarString(header, 0, 100, name);
		writeTarString(header, 100, 8, '0000644');
		writeTarString(header, 124, 12, `${body.byteLength.toString(8).padStart(11, '0')} `);
		writeTarString(header, 257, 6, 'ustar');
		header[156] = 48;
		header.fill(32, 148, 156);
		let checksum = 0;
		for (const value of header) checksum += value;
		writeTarString(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
		blocks.push(header, body);
		if (body.byteLength % 512) blocks.push(new Uint8Array(512 - (body.byteLength % 512)));
	}
	blocks.push(new Uint8Array(1024));
	const total = blocks.reduce((sum, block) => sum + block.byteLength, 0);
	const tar = new Uint8Array(total);
	let offset = 0;
	for (const block of blocks) {
		tar.set(block, offset);
		offset += block.byteLength;
	}
	return tar;
}

function writeTarString(target: Uint8Array, offset: number, length: number, value: string): void {
	target.set(new TextEncoder().encode(String(value)).slice(0, length), offset);
}
