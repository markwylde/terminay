import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import {
	AUTHENTICATED_WEBRTC_TRANSPORT_VERSION,
	deviceJoinProofPayload,
	isEnrollmentPushMessage,
	parseEnrollmentPushMessage,
	parseHostedPairingUrl,
	validateAuthenticatedWebRtcTransportTranscript,
	type EnrollmentPushMessage,
} from '@terminay/protocol';
import { HeadlessChannelTransport, type HeadlessDataChannel } from '@terminay/server-core/remote';
import {
	deriveHostedPairingSecrets,
	hostedSessionId,
	hostedSignalingUrl,
} from '../../apps/terminay-server/src/remote/hostedPairingSecrets';
import {
	DEFAULT_HOSTED_ICE_SERVERS,
	type HostedIceServer,
} from '../../apps/terminay-server/src/remote/hostedPeerLifecycle';
import { loadSelectedSecureWeriftRuntime } from '../../apps/terminay-server/src/remote/secureWeriftRuntime';
import { readSctpMaxMessageBytes } from '../../apps/terminay-server/src/remote/uiArchiveTransfer';
import type { PinnedServerHostKey } from '../../src/remote/services/authenticatedWebRtcTransport';
import { authenticateDevice } from '../../src/remote/services/auth';
import { establishDevicePairing } from '../../src/remote/services/devicePairingFlow';
import type { RemoteApiTransport } from '../../src/remote/services/transport';
import { createDesktopAuthenticatedOfferGate, createDesktopClientNonce } from './desktopAuthenticatedWebRtc';
import type { DesktopDeviceCredentialStore } from './deviceCredentialStore';
import { DesktopWebRtcAssetLane } from './desktopWebRtcTransport';

/**
 * Desktop as a hosted client, on exactly the contract the browser shell uses:
 * join hosted signaling, verify the signed offer transcript before any remote
 * description is installed, then run enrollment or the device challenge on the
 * `api` data channel and authenticate the application lane with the ticket.
 * No HTTPS request ever carries pairing material, a device key, a signature,
 * or a ticket to a hosted origin.
 */

const CHANNEL_LABELS = ['api', 'asset', 'control', 'application', 'terminal', 'assets'] as const;
type ChannelLabel = (typeof CHANNEL_LABELS)[number];
const CONNECT_TIMEOUT_MS = 45_000;
const API_TIMEOUT_MS = 15_000;

type WeriftChannel = {
	readonly bufferedAmount?: number;
	readonly label?: string;
	readonly readyState: string;
	addEventListener(type: string, listener: (event: Record<string, unknown>) => void): void;
	removeEventListener(type: string, listener: (event: Record<string, unknown>) => void): void;
	close?(): void;
	send(data: string | Uint8Array): void;
};
type WeriftPeer = {
	readonly connectionState?: string;
	readonly localDescription: Readonly<{ sdp?: string; type?: string }> | null | undefined;
	addEventListener(type: string, listener: (event: Record<string, unknown>) => void): void;
	addIceCandidate(candidate: Readonly<{ candidate: string; sdpMid: string }>): Promise<void>;
	close(): void;
	createAnswer(): Promise<Readonly<{ sdp?: string; type?: string }>>;
	setLocalDescription(description: Readonly<{ sdp?: string; type?: string }>): Promise<void>;
	setRemoteDescription(description: Readonly<{ sdp: string; type: string }>): Promise<void>;
};

export type DesktopHostedSignalOptions = Readonly<{
	readonly connectHost?: string;
	readonly insecureTls?: boolean;
}>;

export type DesktopHostedScope =
	| Readonly<{ kind: 'pairing'; fragment: string; expectedServerId?: string }>
	| Readonly<{
			kind: 'device';
			deviceId: string;
			pinnedHostKey: PinnedServerHostKey;
			expectedServerId?: string;
			signDeviceJoin: (payload: string) => Promise<string>;
	  }>;

export interface DesktopHostedPeer {
	readonly api: RemoteApiTransport;
	readonly channels: ReadonlyMap<ChannelLabel, HeadlessDataChannel>;
	readonly clientNonce: string;
	readonly hostPublicKey: PinnedServerHostKey;
	readonly serverId: string;
	readonly sessionOrigin: string;
	/** Consume a ticket on the control lane; true only when the server accepted it. */
	authenticate(ticket: string): Promise<boolean>;
	close(): void;
}

export interface DesktopHostedConnection {
	readonly transport: HeadlessChannelTransport;
	readonly assets: DesktopWebRtcAssetLane;
	readonly serverId: string;
	readonly hostContext: unknown;
}

export function isHostedDesktopOrigin(origin: string): boolean {
	const parsed = new URL(origin);
	if (parsed.protocol === 'https:') return true;
	const host = parsed.hostname.toLowerCase();
	return host.endsWith('.localhost') || /^\d+\.127\.0\.0\.1$/u.test(host);
}

/** Open one transport-authenticated hosted peer. Nothing but the join message
 * and answer/ICE frames leave before the offer transcript verifies. */
export async function connectDesktopHostedPeer(options: Readonly<{
	sessionOrigin: string;
	scope: DesktopHostedScope;
	webrtcRuntimeRoot: string;
	iceServers?: readonly HostedIceServer[];
	signal?: DesktopHostedSignalOptions;
	abort?: AbortSignal;
	onPinned?: (pin: PinnedServerHostKey) => void | Promise<void>;
}>): Promise<DesktopHostedPeer> {
	const sessionOrigin = normalizeHostedOrigin(options.sessionOrigin);
	const sessionId = hostedSessionId(sessionOrigin);
	const runtime = await loadSelectedSecureWeriftRuntime(options.webrtcRuntimeRoot);
	const Peer = runtime.RTCPeerConnection as unknown as new (configuration?: Record<string, unknown>) => WeriftPeer;
	const clientNonce = createDesktopClientNonce();
	const secrets = options.scope.kind === 'pairing' ? deriveHostedPairingSecrets(options.scope.fragment) : undefined;
	const socket = openSignalSocket(hostedSignalingUrl(sessionOrigin), sessionOrigin, options.signal);
	const loopbackSignal = isLoopbackHost(options.signal?.connectHost);
	const peer = new Peer({
		iceServers: [...(options.iceServers && options.iceServers.length > 0 ? options.iceServers : DEFAULT_HOSTED_ICE_SERVERS)],
		maxMessageSize: 1024 * 1024,
		...(loopbackSignal
			? {
					iceAdditionalHostAddresses: ['127.0.0.1'],
					iceInterfaceAddresses: { udp4: '127.0.0.1' },
					iceUseIpv4: false,
					iceUseIpv6: false,
				}
			: { iceUseIpv4: true, iceUseIpv6: true }),
	});
	const channels = new Map<ChannelLabel, HeadlessDataChannel>();
	const rawChannels = new Map<ChannelLabel, WeriftChannel>();
	let closed = false;
	const close = () => {
		if (closed) return;
		closed = true;
		try { socket.close(1000, 'Desktop hosted connection closed'); } catch { /* best effort */ }
		try { peer.close(); } catch { /* best effort */ }
	};
	let hostPublicKey: PinnedServerHostKey | undefined;
	let serverId: string | undefined;
	const remoteIce: Array<Readonly<{ candidate: string; sdpMid: string }>> = [];
	let remoteSet = false;
	const scopeId = options.scope.kind === 'pairing' ? secrets!.pairingRoomId : options.scope.deviceId;

	const send = (message: Record<string, unknown>) => {
		if (socket.readyState !== WebSocket.OPEN) return;
		socket.send(JSON.stringify(
			options.scope.kind === 'pairing'
				? { ...message, roomId: scopeId }
				: { ...message, deviceId: scopeId, sessionId },
		));
	};

	const connected = new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => finish(new Error('Desktop hosted pairing timed out before the connection opened.')), CONNECT_TIMEOUT_MS);
		timer.unref?.();
		let settled = false;
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (error) {
				close();
				reject(error);
			} else resolve();
		};
		options.abort?.addEventListener('abort', () => finish(new Error('Desktop hosted pairing was cancelled.')), { once: true });
		socket.on('error', () => finish(new Error('Desktop could not reach hosted signaling.')));
		socket.on('close', () => {
			if (!settled) finish(new Error('Hosted signaling closed before the connection opened.'));
		});
		peer.addEventListener('datachannel', (event) => {
			const channel = event.channel as WeriftChannel;
			const label = channel.label as ChannelLabel;
			if (!CHANNEL_LABELS.includes(label) || rawChannels.has(label)) {
				finish(new Error('The server offered an unexpected data channel.'));
				return;
			}
			rawChannels.set(label, channel);
			channels.set(label, asHeadlessChannel(channel));
			const ready = () => {
				if (CHANNEL_LABELS.every((name) => rawChannels.get(name)?.readyState === 'open')) finish();
			};
			channel.addEventListener('open', ready);
			ready();
		});
		peer.addEventListener('icecandidate', (event) => {
			const raw = event.candidate as Record<string, unknown> | null | undefined;
			const candidate = typeof raw?.toJSON === 'function' ? (raw.toJSON as () => Record<string, unknown>)() : raw;
			if (!candidate || typeof candidate.candidate !== 'string' || candidate.candidate.length === 0) return;
			const sdpMid = typeof candidate.sdpMid === 'string' && candidate.sdpMid.length > 0
				? candidate.sdpMid
				: typeof candidate.sdpMLineIndex === 'number' ? String(candidate.sdpMLineIndex) : '0';
			send({ type: options.scope.kind === 'pairing' ? 'ice' : 'device-ice', candidate: { candidate: candidate.candidate, sdpMid } });
		});
		peer.addEventListener('connectionstatechange', () => {
			if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
				finish(new Error('Desktop hosted WebRTC connection failed.'));
			}
		});
		socket.on('message', (raw) => {
			void (async () => {
				let message: Record<string, unknown>;
				try {
					message = JSON.parse(String(raw)) as Record<string, unknown>;
				} catch {
					return;
				}
				if (message.type === 'error') {
					finish(new Error(typeof message.message === 'string' ? message.message : 'Hosted signaling rejected the connection.'));
					return;
				}
				if (message.type === 'offer' || message.type === 'device-offer') {
					if (remoteSet) return;
					const description = message.sdp as Record<string, unknown> | undefined;
					if (!description || typeof description.sdp !== 'string') throw new Error('The server offer is invalid.');
					const proof = message.authenticatedTransport;
					const expectedServerId = options.scope.expectedServerId
						?? validateAuthenticatedWebRtcTransportTranscript((proof as Record<string, unknown>)?.transcript).serverId;
					const gate = createDesktopAuthenticatedOfferGate({
						clientNonce,
						scope: options.scope.kind === 'pairing' ? 'pairing' : 'reconnect',
						scopeId,
						sessionOrigin,
						serverId: expectedServerId,
						...(options.scope.kind === 'pairing'
							? { pairingSecret: secrets!.qrSecret }
							: { pinnedHostKey: options.scope.pinnedHostKey }),
						...(options.onPinned === undefined ? {} : { onPinned: options.onPinned }),
					});
					const pin = await gate.verifyRemoteDescription(description.sdp, proof);
					hostPublicKey = pin ?? (options.scope.kind === 'device' ? options.scope.pinnedHostKey : undefined);
					serverId = expectedServerId;
					await peer.setRemoteDescription({ type: 'offer', sdp: description.sdp });
					remoteSet = true;
					const answer = await peer.createAnswer();
					await peer.setLocalDescription(answer);
					const local = peer.localDescription;
					if (!local || typeof local.sdp !== 'string') throw new Error('Desktop could not create a WebRTC answer.');
					send({ type: options.scope.kind === 'pairing' ? 'answer' : 'device-answer', sdp: { type: 'answer', sdp: local.sdp } });
					for (const candidate of remoteIce.splice(0)) await peer.addIceCandidate(candidate);
					return;
				}
				if (message.type === 'ice' || message.type === 'device-ice') {
					const candidate = message.candidate as Record<string, unknown> | undefined;
					if (!candidate || typeof candidate.candidate !== 'string' || typeof candidate.sdpMid !== 'string') return;
					const parsed = { candidate: candidate.candidate, sdpMid: candidate.sdpMid };
					if (remoteSet) await peer.addIceCandidate(parsed);
					else remoteIce.push(parsed);
				}
			})().catch((error: unknown) => finish(error instanceof Error ? error : new Error(String(error))));
		});
		socket.once('open', () => {
			void (async () => {
				if (options.scope.kind === 'pairing') {
					send({
						authenticatedTransportVersion: AUTHENTICATED_WEBRTC_TRANSPORT_VERSION,
						type: 'client-join',
						clientNonce,
						relayJoinToken: secrets!.relayJoinToken,
					});
					return;
				}
				const payload = new TextDecoder().decode(deviceJoinProofPayload({ sessionId, clientNonce }));
				send({
					authenticatedTransportVersion: AUTHENTICATED_WEBRTC_TRANSPORT_VERSION,
					type: 'device-join',
					clientNonce,
					deviceProof: await options.scope.signDeviceJoin(payload),
				});
			})().catch((error: unknown) => finish(error instanceof Error ? error : new Error(String(error))));
		});
	});
	await connected;
	if (hostPublicKey === undefined || serverId === undefined) {
		close();
		throw new Error('Desktop hosted connection opened without a verified server identity.');
	}
	const api = createApiLane(rawChannels.get('api')!);
	return Object.freeze({
		api,
		channels,
		clientNonce,
		hostPublicKey,
		serverId,
		sessionOrigin,
		authenticate: (ticket: string) => authenticateApplication(rawChannels.get('control')!, ticket),
		close,
	});
}

/** Pair Desktop with a hosted server. Resolves once the host approved the
 * match code and the device credential plus pinned host key are stored. */
export async function pairDesktopHostedDevice(options: Readonly<{
	pairingUrl: string;
	deviceName: string;
	store: DesktopDeviceCredentialStore;
	webrtcRuntimeRoot: string;
	iceServers?: readonly HostedIceServer[];
	signal?: DesktopHostedSignalOptions;
	abort?: AbortSignal;
	onMatchCode?: (code: Readonly<{ matchCode: string; expiresAt: number }>) => void;
}>): Promise<Readonly<{ deviceId: string; deviceName: string; label: string; origin: string; serverId: string }>> {
	const hosted = parseHostedPairingUrl(options.pairingUrl);
	const origin = hosted.origin;
	const secrets = deriveHostedPairingSecrets(hosted.fragment);
	const pairingExpiresAt = hosted.pairingExpiresAt || new Date(Date.now() + 10 * 60 * 1000).toISOString();
	if (!(Date.parse(pairingExpiresAt) > Date.now())) {
		throw new Error('Desktop pairing URL is expired or has an invalid expiry.');
	}
	const peer = await connectDesktopHostedPeer({
		sessionOrigin: origin,
		scope: { kind: 'pairing', fragment: hosted.fragment },
		webrtcRuntimeRoot: options.webrtcRuntimeRoot,
		...(options.iceServers === undefined ? {} : { iceServers: options.iceServers }),
		...(options.signal === undefined ? {} : { signal: options.signal }),
		...(options.abort === undefined ? {} : { abort: options.abort }),
	});
	try {
		const paired = await establishDevicePairing({
			api: peer.api,
			bootstrap: { pairingExpiresAt, pairingSessionId: secrets.pairingRoomId, pairingToken: secrets.pairingToken },
			credentials: {
				saveDeviceIdentity: (identity) =>
					options.store.saveDeviceIdentity({ ...identity, hostPin: peer.hostPublicKey }),
			},
			deviceName: options.deviceName,
			generateKeyPair: async () => {
				const key = options.store.createDeviceKey(origin);
				return Object.freeze({ privateKey: key.keyRef, publicKeyPem: key.publicKeyPem });
			},
			origin,
			matchCode: { pairingSecret: secrets.qrSecret, clientNonce: peer.clientNonce, hostPublicKey: peer.hostPublicKey.publicKey },
			...(options.onMatchCode === undefined ? {} : { onMatchCode: options.onMatchCode }),
			...(options.abort === undefined ? {} : { signal: options.abort }),
		});
		return Object.freeze({
			deviceId: paired.deviceId,
			deviceName: paired.deviceName,
			label: hosted.label,
			origin,
			serverId: peer.serverId,
		});
	} finally {
		peer.close();
	}
}

/** Reconnect a paired Desktop to a hosted server and return the authenticated
 * application transport and bundle lane from that same verified peer. */
export async function connectDesktopHostedRemote(options: Readonly<{
	origin: string;
	store: DesktopDeviceCredentialStore;
	webrtcRuntimeRoot: string;
	expectedServerId?: string;
	iceServers?: readonly HostedIceServer[];
	signal?: DesktopHostedSignalOptions;
	abort?: AbortSignal;
}>): Promise<DesktopHostedConnection> {
	const origin = normalizeHostedOrigin(options.origin);
	const device = await options.store.loadDevice(origin);
	if (device === null) throw new Error('No paired device exists for this server origin.');
	const pinnedHostKey = await options.store.loadPinnedHostKey(origin);
	if (pinnedHostKey === null) throw new Error('Server host identity is not pinned; explicit re-pairing is required.');
	const peer = await connectDesktopHostedPeer({
		sessionOrigin: origin,
		scope: {
			kind: 'device',
			deviceId: device.deviceId,
			pinnedHostKey,
			signDeviceJoin: (payload) => options.store.signChallenge(origin, payload),
			...(options.expectedServerId === undefined ? {} : { expectedServerId: options.expectedServerId }),
		},
		webrtcRuntimeRoot: options.webrtcRuntimeRoot,
		...(options.iceServers === undefined ? {} : { iceServers: options.iceServers }),
		...(options.signal === undefined ? {} : { signal: options.signal }),
		...(options.abort === undefined ? {} : { abort: options.abort }),
	});
	try {
		const { ticket } = await authenticateDevice({
			api: peer.api,
			deviceId: device.deviceId,
			origin,
			signChallenge: (signingInput) => options.store.signChallenge(origin, signingInput),
		});
		if (!(await peer.authenticate(ticket))) {
			throw new Error('Desktop reconnect was denied by the server.');
		}
		const hostContext = await peer.api.postJson<unknown>('/api/host-context', {});
		const application = peer.channels.get('application')!;
		const assets = peer.channels.get('assets')!;
		const transport = new HeadlessChannelTransport(application);
		transport.onStateChange((state) => {
			if (state === 'closed' || state === 'failed') peer.close();
		});
		return Object.freeze({
			transport,
			assets: new DesktopWebRtcAssetLane(assets),
			serverId: peer.serverId,
			hostContext,
		});
	} catch (error) {
		peer.close();
		throw error;
	}
}

function createApiLane(channel: WeriftChannel): RemoteApiTransport {
	let sequence = 0;
	const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
	const pushListeners = new Set<(message: EnrollmentPushMessage) => void>();
	channel.addEventListener('message', (event) => {
		let message: Record<string, unknown>;
		try {
			message = JSON.parse(String(event.data ?? '')) as Record<string, unknown>;
		} catch {
			return;
		}
		if (isEnrollmentPushMessage(message)) {
			let parsed: EnrollmentPushMessage;
			try {
				parsed = parseEnrollmentPushMessage(message);
			} catch {
				return;
			}
			for (const listener of pushListeners) listener(parsed);
			return;
		}
		if (message.type !== 'api-response' || typeof message.id !== 'string') return;
		const entry = pending.get(message.id);
		if (entry === undefined) return;
		pending.delete(message.id);
		clearTimeout(entry.timer);
		if (message.ok === true) entry.resolve(message.body);
		else entry.reject(new Error(typeof message.error === 'string' ? message.error : 'Terminay rejected the request.'));
	});
	channel.addEventListener('close', () => {
		for (const [id, entry] of pending) {
			pending.delete(id);
			clearTimeout(entry.timer);
			entry.reject(new Error('The hosted connection closed.'));
		}
	});
	return {
		postJson<TResponse>(pathname: string, body: unknown): Promise<TResponse> {
			if (typeof pathname !== 'string' || !pathname.startsWith('/api/') || pathname.length > 128) {
				return Promise.reject(new TypeError('Desktop hosted API endpoint is invalid.'));
			}
			const id = `desktop-${++sequence}-${randomBytes(6).toString('base64url')}`;
			return new Promise<TResponse>((resolve, reject) => {
				const timer = setTimeout(() => {
					pending.delete(id);
					reject(new Error('The server did not answer in time.'));
				}, API_TIMEOUT_MS);
				timer.unref?.();
				pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
				try {
					channel.send(JSON.stringify({ type: 'api-request', id, pathname, body }));
				} catch (error) {
					pending.delete(id);
					clearTimeout(timer);
					reject(error instanceof Error ? error : new Error(String(error)));
				}
			});
		},
		waitForEnrollmentDecision(approvalId, options) {
			return new Promise<EnrollmentPushMessage>((resolve, reject) => {
				const timer = setTimeout(() => {
					pushListeners.delete(listener);
					reject(new Error('The pairing request expired before it was approved. Scan a fresh QR code.'));
				}, Math.max(1_000, options.expiresAt - Date.now() + 5_000));
				timer.unref?.();
				const listener = (message: EnrollmentPushMessage) => {
					if (message.approvalId !== approvalId) return;
					pushListeners.delete(listener);
					clearTimeout(timer);
					resolve(message);
				};
				pushListeners.add(listener);
				options.signal?.addEventListener('abort', () => {
					pushListeners.delete(listener);
					clearTimeout(timer);
					reject(new Error('Desktop pairing was cancelled.'));
				}, { once: true });
			});
		},
	};
}

function authenticateApplication(control: WeriftChannel, ticket: string): Promise<boolean> {
	const id = `auth-${randomBytes(6).toString('base64url')}`;
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			control.removeEventListener('message', listener);
			reject(new Error('The server did not confirm the workspace in time.'));
		}, API_TIMEOUT_MS);
		timer.unref?.();
		const listener = (event: Record<string, unknown>) => {
			let message: Record<string, unknown>;
			try {
				message = JSON.parse(String(event.data ?? '')) as Record<string, unknown>;
			} catch {
				return;
			}
			if (message.type !== 'application-authenticated' || message.id !== id) return;
			control.removeEventListener('message', listener);
			clearTimeout(timer);
			resolve(message.ok === true);
		};
		control.addEventListener('message', listener);
		control.send(JSON.stringify({ type: 'application-auth', id, ticket }));
	});
}

function asHeadlessChannel(channel: WeriftChannel): HeadlessDataChannel {
	const listeners = new Set<(state: HeadlessDataChannel['readyState']) => void>();
	const emit = () => {
		for (const listener of listeners) listener(mapState(channel.readyState));
	};
	channel.addEventListener('open', emit);
	channel.addEventListener('close', emit);
	channel.addEventListener('error', emit);
	return {
		get label() {
			return channel.label ?? 'application';
		},
		get readyState() {
			return mapState(channel.readyState);
		},
		get bufferedAmount() {
			return typeof channel.bufferedAmount === 'number' ? channel.bufferedAmount : 0;
		},
		get maxMessageBytes() {
			return readSctpMaxMessageBytes(channel as never);
		},
		send(frame) {
			if (channel.readyState !== 'open') throw new Error('Desktop hosted data channel is not open.');
			channel.send(frame);
		},
		close() {
			channel.close?.();
		},
		onMessage(listener) {
			const handler = (event: Record<string, unknown>) => {
				const value = event.data;
				const frame = value instanceof ArrayBuffer
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

function mapState(state: string): HeadlessDataChannel['readyState'] {
	if (state === 'open') return 'open';
	if (state === 'connecting') return 'connecting';
	if (state === 'closing') return 'closing';
	return 'closed';
}

function openSignalSocket(signalingUrl: string, origin: string, signal: DesktopHostedSignalOptions | undefined): WebSocket {
	const url = new URL(signalingUrl);
	const connectUrl = signal?.connectHost
		? `${url.protocol}//${url.port ? `${signal.connectHost}:${url.port}` : signal.connectHost}${url.pathname}`
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

function isLoopbackHost(host: string | undefined): boolean {
	return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function normalizeHostedOrigin(value: string): string {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new TypeError('Desktop hosted origin is invalid.');
	}
	if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
		throw new TypeError('Desktop hosted origin must be an exact origin.');
	}
	if (parsed.protocol !== 'https:' && !isHostedDesktopOrigin(parsed.origin)) {
		throw new TypeError('Desktop hosted origin must use HTTPS.');
	}
	return parsed.origin;
}
