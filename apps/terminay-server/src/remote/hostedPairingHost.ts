import { networkInterfaces } from 'node:os';
import { gzipSync } from 'node:zlib';
import { createPrivateKey, randomBytes, sign, timingSafeEqual } from 'node:crypto';
import { WebSocket } from 'ws';
import {
	AUTHENTICATED_WEBRTC_TRANSPORT_VERSION,
	createAuthenticatedWebRtcPairingAuthenticator,
	createAuthenticatedWebRtcTransportTranscript,
	extractAuthenticatedWebRtcFingerprints,
	serializeAuthenticatedWebRtcTransportTranscript,
	sha256Base64Url,
	type AuthenticatedWebRtcTransportScope,
	type ByteTransport,
} from '@terminay/protocol';
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
import {
	applyHostedLaneDiagnostic,
	collectHostIceAddresses,
	createHandshakeJoinQueue,
	DEVICE_HOST_AVAILABILITY_MS,
	deviceHostRefreshDelayMs,
	type HostedIceServer,
	HostedGenerationSet,
	HostedPeerLifecycle,
	hostedPeerConfiguration,
	resolveIceRecoveryGraceMs,
	shouldFailHostedStall,
} from './hostedPeerLifecycle.js';
import { createHostedStreamDiagnostics, frameByteLength } from './hostedStreamDiagnostics.js';

export {
	applyHostedLaneDiagnostic,
	collectHostIceAddresses,
	createHandshakeJoinQueue,
	DEFAULT_HOSTED_ICE_SERVERS,
	DEFAULT_ICE_RECOVERY_GRACE_MS,
	DEVICE_HOST_AVAILABILITY_MS,
	DEVICE_REFRESH_LEAD_MS,
	deviceHostRefreshDelayMs,
	HostedGenerationSet,
	HostedPeerLifecycle,
	hostedPeerConfiguration,
	parseHostedIceServers,
	resolveHostedIceServers,
	resolveIceRecoveryGraceMs,
} from './hostedPeerLifecycle.js';
export type { HostedIceServer } from './hostedPeerLifecycle.js';

const CHANNELS = ['api', 'asset', 'control', 'application', 'terminal', 'assets'] as const;

type WeriftIceCandidate = Readonly<{
	candidate?: string;
	sdpMLineIndex?: number | null;
	sdpMid?: string | null;
	toJSON?: () => WeriftIceCandidate;
}>;
type WeriftPeer = {
	readonly connectionState?: string;
	readonly iceConnectionState?: string;
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

export type HostedConnectedPeer = Readonly<{
	connectionId: string;
	deviceId: string;
	deviceName: string;
}>;

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
	readonly iceServers?: readonly HostedIceServer[];
	readonly resolveIceServers?: () => readonly HostedIceServer[];
	readonly iceRecoveryGraceMs?: number;
	readonly rotateHandoff?: () => ServerPairingHandoff;
	readonly onHandoff?: (handoff: ServerPairingHandoff) => void;
	readonly onPeerConnected?: (peer: HostedConnectedPeer) => void;
	readonly onPeerDisconnected?: (connectionId: string) => void;
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
		| 'failed'
		| 'peer-state'
		| 'ice-grace'
		| 'channel-state'
		| 'application-lane'
		| 'peer-closed';
	readonly scope?: 'pairing' | 'device';
	readonly advertisedUrlClass?: 'manager' | 'session' | 'loopback' | 'other';
	readonly signalingHostClass?: 'terminay-session' | 'loopback' | 'other';
	readonly closeCode?: number;
	readonly closeReasonClass?: string;
	readonly remainingMs?: number;
	readonly cause?: string;
	readonly peerState?: string | undefined;
	readonly iceState?: string | undefined;
	readonly iceGracePhase?: 'started' | 'cleared' | 'expired';
	readonly channel?: 'api' | 'asset' | 'assets' | 'application' | 'control' | 'terminal';
	readonly channelState?: string | undefined;
	readonly inboundFrames?: number;
	readonly outboundFrames?: number;
	readonly inboundBytes?: number;
	readonly outboundBytes?: number;
	readonly lastInboundAgeMs?: number | null;
	readonly lastOutboundAgeMs?: number | null;
	readonly firstInboundAgeMs?: number | null;
	readonly firstOutboundAgeMs?: number | null;
	readonly liveGenerationCount?: number;
	readonly stallIgnored?: boolean;
	readonly inboundKind?: 'bytes' | 'blob' | 'string' | 'empty' | 'other' | undefined;
	readonly droppedFrames?: number;
	readonly droppedClass?: 'bytes' | 'blob' | 'string' | 'empty' | 'other';
	readonly sendFailures?: number;
	readonly sendFailure?: boolean;
	readonly stallClass?: 'no-outbound' | 'outbound-stalled';
	readonly first?: 'inbound' | 'outbound';
	readonly summary?: boolean;
	readonly reasonClass?: string;
	readonly bufferedAmount?: number;
}>;

export interface HostedPairingHost {
	readonly close: () => Promise<void>;
	/** Mint and advertise a replacement one-time pairing room. Live peers stay up. */
	readonly mintPairing: () => Promise<void>;
}

const PAIRING_REFRESH_LEAD_MS = 15_000;
const PAIRING_CONSUMED_ROTATE_MS = 3_000;
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
	const generations = new HostedGenerationSet();
	const context = { archive, options, generations };
	const joinQueue = createHandshakeJoinQueue();
	let handshakeGeneration = 0;
	let handshake:
		| Readonly<{ generation: number; peer: WeriftPeer }>
		| undefined;
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
	let pairingRefreshChain = Promise.resolve();

	const diagnose = (event: HostedPairingDiagnostic) => {
		options.onDiagnostic?.(event);
	};

	const close = async () => {
		if (closed) return;
		closed = true;
		clearTimeout(pairingRefreshTimer);
		clearTimeout(deviceRefreshTimer);
		handshake?.peer.close();
		generations.closeAll();
		pairingGeneration += 1;
		deviceGeneration += 1;
		closeSocket(pairingSocket);
		closeSocket(deviceSocket);
	};

	async function addHandshakePeer(socket: WebSocket, scope: SignalScope): Promise<void> {
		const generation = ++handshakeGeneration;
		if (handshake) {
			handshake.peer.close();
		}
		handshake = undefined;
		const next = await startPeer(
			Peer,
			socket,
			scope,
			context,
			(connection, peer) => {
				if (handshake?.peer === next) {
					generations.add({ peer: next, connection });
					handshake = undefined;
				}
				options.onPeerConnected?.(peer);
				if (scope.kind === 'pairing') {
					clearTimeout(pairingRefreshTimer);
					pairingRefreshTimer = setTimeout(() => {
						void refreshPairing('consumed');
					}, PAIRING_CONSUMED_ROTATE_MS);
					pairingRefreshTimer.unref?.();
				}
			},
			(retired) => {
				generations.drop(retired);
			},
		);
		if (closed || generation !== handshakeGeneration) {
			next.close();
			return;
		}
		handshake = { generation, peer: next };
	}

	async function handlePairingSignal(
		message: Record<string, unknown> | undefined,
		derived: ReturnType<typeof deriveHostedPairingSecrets>,
		socket: WebSocket,
		registered: ReturnType<typeof waitForSignalType>,
	): Promise<void> {
		if (!message || registered.handle(message)) return;
		if (message.type === 'client-join') {
			assertAuthenticatedTransportVersion(message.authenticatedTransportVersion);
			diagnose({ type: 'client-join', scope: 'pairing' });
			const clientNonce = parseClientNonce(message.clientNonce);
			await joinQueue.enqueue(() =>
				addHandshakePeer(socket, {
					kind: 'pairing',
					roomId: derived.pairingRoomId,
					clientNonce,
					pairingSecret: derived.qrSecret,
				}),
			);
			return;
		}
		if (message.type === 'answer' || message.type === 'ice') {
			await joinQueue.enqueue(() => applyHandshakeSignal(message));
		}
	}

	async function handleDeviceSignal(
		message: Record<string, unknown> | undefined,
		socket: WebSocket,
		registered: ReturnType<typeof waitForSignalType>,
	): Promise<void> {
		if (!message || registered.handle(message)) return;
		if (message.type === 'device-join') {
			assertAuthenticatedTransportVersion(message.authenticatedTransportVersion);
			diagnose({ type: 'client-join', scope: 'device' });
			const clientNonce = parseClientNonce(message.clientNonce);
			const deviceId = parseDeviceId(message.deviceId);
			await joinQueue.enqueue(() =>
				addHandshakePeer(socket, { kind: 'device', sessionId, deviceId, clientNonce }),
			);
			return;
		}
		if (message.type === 'device-answer' || message.type === 'device-ice') {
			await joinQueue.enqueue(() => applyHandshakeSignal(message));
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
					authenticatedTransportVersion: AUTHENTICATED_WEBRTC_TRANSPORT_VERSION,
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

	function refreshPairing(cause: string): Promise<void> {
		pairingRefreshChain = pairingRefreshChain.then(
			() => refreshPairingNow(cause),
			() => refreshPairingNow(cause),
		);
		return pairingRefreshChain;
	}

	async function refreshPairingNow(cause: string): Promise<void> {
		if (closed) return;
		const remaining = Date.parse(currentHandoff.pairingExpiresAt) - Date.now();
		const forceRotate = cause === 'consumed' || cause === 'mint';
		const shouldRotate =
			Boolean(options.rotateHandoff) &&
			(forceRotate || !(remaining > PAIRING_REFRESH_LEAD_MS));
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
		const delay = deviceHostRefreshDelayMs(deviceExpiresAt, Date.now());
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

	return {
		close,
		mintPairing: () => refreshPairing('mint'),
	};

	async function applyHandshakeSignal(message: Record<string, unknown>): Promise<void> {
		const current = handshake;
		if (!current || current.generation !== handshakeGeneration) return;
		try {
			if (message.type === 'answer' || message.type === 'device-answer') {
				const description = asSessionDescription(message.sdp);
				if (description) await current.peer.setRemoteDescription(description);
				return;
			}
			const candidate = asIceCandidate(message.candidate);
			if (candidate) await current.peer.addIceCandidate(candidate);
		} catch (error) {
			logHostError(error);
		}
	}

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
	| {
			readonly kind: 'pairing';
			readonly roomId: string;
			readonly clientNonce: string;
			readonly pairingSecret: string;
	  }
	| {
			readonly kind: 'device';
			readonly sessionId: string;
			readonly deviceId: string;
			readonly clientNonce: string;
	  };

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
		generations: HostedGenerationSet;
		options: HostedPairingHostOptions;
	}>,
	onApplication: (connection: ServerConnectionLike, peer: HostedConnectedPeer) => void,
	onRetire: (peer: WeriftPeer) => void,
): Promise<WeriftPeer> {
	const native = new Peer(
		hostedPeerConfiguration(
			context.options.signal?.connectHost,
			context.options.resolveIceServers?.() ?? context.options.iceServers,
			collectHostIceAddresses(networkInterfaces()),
		),
	);
	const session: { connection?: ServerConnectionLike; peer?: HostedConnectedPeer } = {};
	let lifecycle: HostedPeerLifecycle;
	let wrapped: WeriftPeer;
	const stream = createHostedStreamDiagnostics({
		emit: (event) => {
			const enriched = {
				...event,
				liveGenerationCount: context.generations.size,
				...(event.stallClass === undefined
					? {}
					: { stallIgnored: !shouldFailHostedStall(event) }),
			};
			context.options.onDiagnostic?.(enriched);
			applyHostedLaneDiagnostic(lifecycle, enriched);
		},
	});
	lifecycle = new HostedPeerLifecycle(
		native,
		resolveIceRecoveryGraceMs(context.options.iceRecoveryGraceMs),
		(reason) => {
			stream.peerClosed(reason);
			const connectionId = session.peer?.connectionId;
			onRetire(wrapped);
			void session.connection?.close();
			try {
				native.close();
			} catch {
				/* Best effort after ICE/peer failure. */
			}
			if (connectionId) context.options.onPeerDisconnected?.(connectionId);
		},
		{
			onGrace(phase, peerState, iceState) {
				stream.iceGrace(phase, peerState, iceState);
			},
		},
	);
	wrapped = wrapPeer(native, lifecycle);
	const peer = wrapped;
	const channels = Object.fromEntries(
		CHANNELS.map((label) => [label, peer.createDataChannel(label, { ordered: true })]),
	) as Record<(typeof CHANNELS)[number], WeriftDataChannel>;
	native.addEventListener('connectionstatechange', () => {
		lifecycle.observe('peer');
		stream.peerState(native.connectionState, native.iceConnectionState);
	});
	native.addEventListener('iceconnectionstatechange', () => {
		lifecycle.observe('ice');
		stream.peerState(native.connectionState, native.iceConnectionState);
	});
	for (const label of CHANNELS) {
		const channel = channels[label]!;
		const emitState = () => {
			stream.channelState(label, channel.readyState);
			applyHostedLaneDiagnostic(lifecycle, {
				channel: label,
				channelState: channel.readyState,
			});
		};
		channel.addEventListener('open', emitState);
		channel.addEventListener('close', emitState);
		channel.addEventListener('error', emitState);
	}

	peer.addEventListener('icecandidate', (event) => {
		const candidate = asIceCandidate(event.candidate);
		if (!candidate || socket.readyState !== WebSocket.OPEN) return;
		socket.send(JSON.stringify(signalMessage(scope, 'ice', { candidate })));
	});
	bindApi(channels.api!, context);
	bindControl(channels.control!, channels.application!, context, stream, (connection, connected) => {
		session.connection = connection;
		session.peer = connected;
		onApplication(connection, connected);
	});
	bindUiArchiveChannels([channels.asset!, channels.assets!], context.archive);

	const offer = await peer.createOffer();
	if (typeof offer.sdp !== 'string' || typeof offer.type !== 'string') {
		throw new Error('Hosted pairing host could not create a WebRTC offer.');
	}
	const signalingOffer = await createAuthenticatedTransportSignal({
		hostKey: context.options.hostKey,
		offer,
		scope,
		serverId: context.options.serverId,
		sessionOrigin: context.options.handoff.sessionOrigin,
	});
	await peer.setLocalDescription(offer);
	socket.send(JSON.stringify(signalMessage(scope, 'offer', signalingOffer)));
	return peer;
}

export async function createAuthenticatedTransportSignal(input: Readonly<{
	hostKey: HostedHostKey;
	offer: Readonly<{ sdp?: string; type?: string }>;
	scope: SignalScope;
	serverId: string;
	sessionOrigin: string;
}>): Promise<Readonly<{ authenticatedTransport: Record<string, unknown>; sdp: Readonly<{ sdp: string; type: string }> }>> {
	if (typeof input.offer.sdp !== 'string' || typeof input.offer.type !== 'string') {
		throw new Error('Hosted pairing host could not snapshot its WebRTC offer.');
	}
	const sdp = input.offer.sdp;
	const type = input.offer.type;
	const authenticatedTransport = await createAuthenticatedTransportOffer({
		hostKey: input.hostKey,
		scope: input.scope,
		sdp,
		serverId: input.serverId,
		sessionOrigin: input.sessionOrigin,
	});
	return Object.freeze({ authenticatedTransport, sdp: Object.freeze({ sdp, type }) });
}

export async function createAuthenticatedTransportOffer(input: Readonly<{
	hostKey: HostedHostKey;
	scope: SignalScope;
	sdp: string;
	serverId: string;
	sessionOrigin: string;
}>): Promise<Record<string, unknown>> {
	const issuedAt = Date.now();
	const scope: AuthenticatedWebRtcTransportScope = input.scope.kind === 'pairing' ? 'pairing' : 'reconnect';
	const transcript = createAuthenticatedWebRtcTransportTranscript({
		scope,
		scopeId: input.scope.kind === 'pairing' ? input.scope.roomId : input.scope.deviceId,
		sessionOrigin: input.sessionOrigin,
		serverId: input.serverId,
		hostKeyAlgorithm: 'ed25519',
		hostPublicKey: input.hostKey.publicKey,
		clientNonce: input.scope.clientNonce,
		offerId: randomBytes(32).toString('base64url'),
		issuedAt,
		expiresAt: issuedAt + 60_000,
		sdpSha256: await sha256Base64Url(input.sdp),
		fingerprints: extractAuthenticatedWebRtcFingerprints(input.sdp),
	});
	const hostSignature = sign(
		null,
		Buffer.from(serializeAuthenticatedWebRtcTransportTranscript(transcript)),
		createPrivateKey(input.hostKey.privateKeyPem),
	).toString('base64url');
	return Object.freeze({
		transcript,
		hostSignature,
		...(input.scope.kind === 'pairing'
			? {
					pairingAuthenticator: await createAuthenticatedWebRtcPairingAuthenticator(
						input.scope.pairingSecret,
						transcript,
					),
			  }
			: {}),
	});
}

function parseClientNonce(value: unknown): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(value)) {
		throw new Error('Hosted signaling client nonce is invalid.');
	}
	return value;
}

function parseDeviceId(value: unknown): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/u.test(value)) {
		throw new Error('Hosted signaling device id is invalid.');
	}
	return value;
}

function assertAuthenticatedTransportVersion(value: unknown): void {
	if (value !== AUTHENTICATED_WEBRTC_TRANSPORT_VERSION) {
		throw new Error('Hosted signaling authenticated transport version is incompatible.');
	}
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
		deviceId: scope.deviceId,
		sessionId: scope.sessionId,
		type: kind === 'offer' ? 'device-offer' : 'device-ice',
	};
}

function wrapPeer(peer: WeriftPeer, lifecycle: HostedPeerLifecycle): WeriftPeer {
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
		close: () => {
			lifecycle.stop();
			peer.close();
		},
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
	stream: ReturnType<typeof createHostedStreamDiagnostics>,
	onApplication: (connection: ServerConnectionLike, peer: HostedConnectedPeer) => void,
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
				new HeadlessChannelTransport(asHeadlessChannel(application, stream)),
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
			const device = context.options.remote.devices
				.list()
				.find((entry) => entry.deviceId === ticket.deviceId);
			const peer = Object.freeze({
				connectionId: connection.connectionId,
				deviceId: ticket.deviceId,
				deviceName: device?.deviceName?.trim() || 'Browser',
			});
			onApplication(connection, peer);
			application.addEventListener('close', () => {
				context.options.onPeerDisconnected?.(peer.connectionId);
			});
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

function asHeadlessChannel(
	channel: WeriftDataChannel,
	stream?: ReturnType<typeof createHostedStreamDiagnostics>,
): HeadlessDataChannel {
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
			try {
				safeChannelSend(channel, frame);
				stream?.noteOutbound(frameByteLength(frame));
			} catch (error) {
				stream?.noteOutbound(frameByteLength(frame), false);
				throw error;
			}
		},
		close() {
			channel.close?.();
		},
		onMessage(listener) {
			const handler = (event: Record<string, unknown>) => {
				const value = event.data;
				stream?.noteInbound(value);
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
