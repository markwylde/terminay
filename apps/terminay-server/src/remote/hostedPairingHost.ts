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

const CHANNELS = ['api', 'asset', 'control', 'application', 'terminal', 'assets'] as const;
const ARCHIVE_MAGIC = [0x54, 0x42, 0x01, 0x01];

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
}

export interface HostedPairingHost {
	readonly close: () => Promise<void>;
}

export async function startHostedPairingHost(
	options: HostedPairingHostOptions,
): Promise<HostedPairingHost> {
	const qrSecret = new URL(options.handoff.pairingUrl).hash.slice(1);
	const derived = deriveHostedPairingSecrets(qrSecret);
	const sessionId = hostedSessionId(options.handoff.sessionOrigin);
	const signalingUrl = hostedSignalingUrl(options.handoff.sessionOrigin);
	const runtime = await loadSelectedSecureWeriftRuntime(options.webrtcRuntimeRoot);
	const Peer = runtime.RTCPeerConnection as unknown as new (
		configuration?: Record<string, unknown>,
	) => WeriftPeer;
	const archive = options.getUiArchive
		? await options.getUiArchive()
		: createMinimalUiArchive();
	const pairingSocket = openSignalSocket(
		signalingUrl,
		options.handoff.sessionOrigin,
		options.signal,
	);
	const deviceSocket = openSignalSocket(
		signalingUrl,
		options.handoff.sessionOrigin,
		options.signal,
	);
	let peer: WeriftPeer | undefined;
	let applicationConnection: ServerConnectionLike | undefined;
	let closed = false;
	const pairingRegistered = waitForSignalType(pairingSocket, 'host-registered');
	const deviceRegistered = waitForSignalType(deviceSocket, 'device-host-registered');
	let registrationTimeout: ReturnType<typeof setTimeout> | undefined;

	const close = async () => {
		if (closed) return;
		closed = true;
		peer?.close();
		void applicationConnection?.close();
		closeSocket(pairingSocket);
		closeSocket(deviceSocket);
	};

	const context = { archive, options };
	pairingSocket.on('message', (raw) => {
		void handlePairingSignal(parseSignal(raw)).catch(logHostError);
	});
	deviceSocket.on('message', (raw) => {
		void handleDeviceSignal(parseSignal(raw)).catch(logHostError);
	});
	pairingSocket.once('close', () => {
		if (!closed) void close();
	});
	deviceSocket.once('close', () => {
		if (!closed) void close();
	});

	async function replacePeer(socket: WebSocket, scope: SignalScope): Promise<void> {
		peer?.close();
		void applicationConnection?.close();
		applicationConnection = undefined;
		peer = await startPeer(Peer, socket, scope, context, (connection) => {
			applicationConnection = connection;
		});
	}

	async function handlePairingSignal(message: Record<string, unknown> | undefined): Promise<void> {
		if (!message || pairingRegistered.handle(message)) return;
		if (message.type === 'client-join') {
			await replacePeer(pairingSocket, { kind: 'pairing', roomId: derived.pairingRoomId });
			return;
		}
		if (message.type === 'answer' && peer) {
			const description = asSessionDescription(message.sdp);
			if (description) await peer.setRemoteDescription(description);
			return;
		}
		if (message.type === 'ice' && peer) {
			const candidate = asIceCandidate(message.candidate);
			if (candidate) await peer.addIceCandidate(candidate);
		}
	}

	async function handleDeviceSignal(message: Record<string, unknown> | undefined): Promise<void> {
		if (!message || deviceRegistered.handle(message)) return;
		if (message.type === 'device-join') {
			await replacePeer(deviceSocket, { kind: 'device', sessionId });
			return;
		}
		if (message.type === 'device-answer' && peer) {
			const description = asSessionDescription(message.sdp);
			if (description) await peer.setRemoteDescription(description);
			return;
		}
		if (message.type === 'device-ice' && peer) {
			const candidate = asIceCandidate(message.candidate);
			if (candidate) await peer.addIceCandidate(candidate);
		}
	}

	await waitForOpen(pairingSocket);
	pairingSocket.send(
		JSON.stringify({
			expiresAt: options.handoff.pairingExpiresAt,
			relayJoinTokenHash: derived.relayJoinTokenHash,
			roomId: derived.pairingRoomId,
			type: 'host-ready',
		}),
	);
	await waitForOpen(deviceSocket);
	deviceSocket.send(
		JSON.stringify(
			createDeviceHostReadyMessage({
				expiresAt: new Date(Date.now() + 25 * 60 * 1000).toISOString(),
				hostKey: options.hostKey,
				sessionId,
			}),
		),
	);
	await Promise.race([
		Promise.all([pairingRegistered.promise, deviceRegistered.promise]).finally(() => {
			clearTimeout(registrationTimeout);
		}),
		new Promise<never>((_, reject) => {
			registrationTimeout = setTimeout(() => {
				reject(new Error('Hosted signaling room registration timed out.'));
			}, 10_000);
		}),
	]);

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
	return new WebSocket(connectUrl, socketOptions);
}

function closeSocket(socket: WebSocket): void {
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

function formatConnectHost(host: string, port: string): string {
	return port ? `${host}:${port}` : host;
}

function waitForOpen(socket: WebSocket): Promise<void> {
	if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
	return new Promise((resolve, reject) => {
		socket.once('open', () => resolve());
		socket.once('error', () => reject(new Error('Hosted signaling could not connect.')));
	});
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
	const native = new Peer({ iceServers: [], maxMessageSize: 1024 * 1024 });
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
	bindAsset(channels.asset!, context.archive);

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
				channel.send(JSON.stringify({ body, id: request.id, ok: true, type: 'api-response' }));
			} catch (error) {
				channel.send(
					JSON.stringify({
						error: error instanceof Error ? error.message : 'Terminay rejected the bootstrap request.',
						id: request.id,
						ok: false,
						type: 'api-response',
					}),
				);
			}
		})();
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
		channel.send(
			JSON.stringify({
				error: ok ? undefined : 'Terminay rejected the workspace.',
				id: request.id,
				ok,
				type: 'application-authenticated',
			}),
		);
		if (!ok || !ticket || context.options.acceptApplication === undefined) return;
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
	});
}

function bindAsset(channel: WeriftDataChannel, archive: MinimalArchive): void {
	channel.addEventListener('message', (event) => {
		let request: Record<string, unknown>;
		try {
			request = JSON.parse(String(event.data ?? '')) as Record<string, unknown>;
		} catch {
			return;
		}
		if (request.type === 'asset:get-bundle' && typeof request.id === 'string') {
			void sendArchive(channel, archive, request.id);
		}
	});
}

async function sendArchive(
	channel: WeriftDataChannel,
	archive: MinimalArchive,
	id: string,
): Promise<void> {
	const waiters = new Map<number, () => void>();
	const onMessage = (event: Record<string, unknown>) => {
		let message: Record<string, unknown>;
		try {
			message = JSON.parse(String(event.data ?? '')) as Record<string, unknown>;
		} catch {
			return;
		}
		if (message.type === 'asset:bundle-ack' && message.id === id) {
			waiters.get(Number(message.index))?.();
		}
	};
	channel.addEventListener('message', onMessage);
	try {
		channel.send(
			JSON.stringify({
				archiveFormatVersion: 1,
				bundleId: archive.bundleId,
				chunkBytes: archive.bytes.byteLength,
				chunks: 1,
				compressedBytes: archive.bytes.byteLength,
				id,
				type: 'asset:bundle-start',
			}),
		);
		const acked = new Promise<void>((resolve) => waiters.set(0, resolve));
		channel.send(archiveFrame(0, archive.bytes));
		await Promise.race([
			acked,
			delay(15_000).then(() => {
				throw new Error('Archive acknowledgement timed out.');
			}),
		]);
		channel.send(JSON.stringify({ id, type: 'asset:bundle-complete' }));
	} finally {
		channel.removeEventListener('message', onMessage);
	}
}

function archiveFrame(index: number, bytes: Uint8Array): Uint8Array {
	const frame = new Uint8Array(8 + bytes.byteLength);
	frame.set(ARCHIVE_MAGIC, 0);
	new DataView(frame.buffer).setUint32(4, index, false);
	frame.set(bytes, 8);
	return frame;
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
			channel.send(frame);
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

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
