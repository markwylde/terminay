import { createHash, hkdfSync } from 'node:crypto';
import WebSocket from 'ws';
import type { NodeDataChannelHeadlessHostOptions } from '../../apps/terminay-server/src/remote/nodeDataChannelHost';

const REGISTRATION_TIMEOUT_MS = 10_000;
export interface HostedPairingHandoff {
	readonly expiresAt: number;
	readonly pairingUrl: string;
	readonly secret: string;
}

export interface HostedSignalingRoomRegistration {
	readonly active: boolean;
	readonly roomId: string;
	close(): Promise<void>;
}

export interface HostedSignalingRoomRegistrar {
	register(
		handoff: HostedPairingHandoff,
	): Promise<HostedSignalingRoomRegistration>;
}

/** Room registration alone cannot carry authenticated SDP/ICE. Production
 * headless composition requires this additional per-peer signaling factory. */
export interface AuthenticatedHostedSignalingRoomRegistrar
	extends HostedSignalingRoomRegistrar {
	readonly createSignaling: NodeDataChannelHeadlessHostOptions['createSignaling'];
}

type SignalingSocket = {
	readonly readyState: number;
	close(code?: number, reason?: string): void;
	on(
		event: 'open' | 'close' | 'error' | 'message',
		listener: (...args: unknown[]) => void,
	): void;
	send(data: string): void;
};

export function createHostedSignalingRoomRegistrar(
	options: {
		readonly openSocket?: (url: string, origin: string) => SignalingSocket;
		readonly registrationTimeoutMs?: number;
		readonly now?: () => number;
	} = {},
): HostedSignalingRoomRegistrar {
	const openSocket =
		options.openSocket ??
		((url, origin) =>
			new WebSocket(url, { origin }) as unknown as SignalingSocket);
	const timeoutMs = options.registrationTimeoutMs ?? REGISTRATION_TIMEOUT_MS;
	const now = options.now ?? Date.now;

	return {
		async register(handoff) {
			const material = deriveHostedRegistrationMaterial(handoff);
			if (handoff.expiresAt <= now())
				throw new Error('Hosted signaling room already expired.');
			const socket = openSocket(material.signalingUrl, material.appOrigin);
			let active = false;
			let expiryTimer: ReturnType<typeof setTimeout> | undefined;
			let timeout: ReturnType<typeof setTimeout> | undefined;
			const close = async () => {
				active = false;
				if (timeout !== undefined) clearTimeout(timeout);
				if (expiryTimer !== undefined) clearTimeout(expiryTimer);
				if (socket.readyState === WebSocket.OPEN) {
					socket.send(
						JSON.stringify({
							roomId: material.roomId,
							type: 'room-complete',
						}),
					);
					socket.close(1000, 'Terminay exposure stopped');
				} else if (socket.readyState === WebSocket.CONNECTING) {
					socket.close(1000, 'Terminay exposure stopped');
				}
			};
			await new Promise<void>((resolve, reject) => {
				let settled = false;
				const fail = (error: Error) => {
					if (settled) return;
					settled = true;
					void close();
					reject(error);
				};
				timeout = setTimeout(
					() =>
						fail(new Error('Hosted signaling room registration timed out.')),
					timeoutMs,
				);
				socket.on('open', () => {
					socket.send(
						JSON.stringify({
							expiresAt: new Date(handoff.expiresAt).toISOString(),
							relayJoinTokenHash: material.relayJoinTokenHash,
							roomId: material.roomId,
							type: 'host-ready',
						}),
					);
				});
				socket.on('message', (raw) => {
					let message: unknown;
					try {
						message = JSON.parse(String(raw));
					} catch {
						return;
					}
					if (!isRecord(message) || message.roomId !== material.roomId) return;
					if (settled) {
						// Room registration alone is not a WebRTC host. Until Desktop
						// supplies the server-owned node-datachannel peer/signing
						// boundary, complete the admitted room instead of leaving the
						// browser indefinitely at "Establishing secure channel". The
						// relay's closed protocol does not admit host-authored error
						// frames; room-complete is its fail-closed control and makes the
						// browser surface its explicit pre-WebRTC connection failure.
						if (active && message.type === 'client-join') {
							void close();
						}
						return;
					}
					if (message.type === 'error') {
						fail(
							new Error(
								typeof message.message === 'string'
									? message.message
									: 'Hosted signaling rejected room registration.',
							),
						);
						return;
					}
					if (message.type !== 'host-registered') return;
					settled = true;
					if (timeout !== undefined) clearTimeout(timeout);
					active = true;
					expiryTimer = setTimeout(
						() => {
							void close();
						},
						Math.max(1, handoff.expiresAt - now()),
					);
					expiryTimer.unref?.();
					resolve();
				});
				socket.on('error', () =>
					fail(new Error('Hosted signaling room registration failed.')),
				);
				socket.on('close', () => {
					active = false;
					if (!settled)
						fail(
							new Error('Hosted signaling closed before room registration.'),
						);
				});
			});
			return {
				get active() {
					return active;
				},
				roomId: material.roomId,
				close,
			};
		},
	};
}

export function deriveHostedRegistrationMaterial(
	handoff: HostedPairingHandoff,
) {
	const url = new URL(handoff.pairingUrl);
	if (
		!/^[A-Za-z0-9_-]{43,512}$/u.test(handoff.secret) ||
		url.hash.slice(1) !== handoff.secret
	) {
		throw new Error('Hosted pairing handoff is invalid.');
	}
	const secret = Buffer.from(handoff.secret, 'base64url');
	if (
		secret.byteLength < 32 ||
		secret.toString('base64url') !== handoff.secret
	) {
		throw new Error('Hosted pairing handoff is invalid.');
	}
	const derive = (purpose: string) =>
		Buffer.from(
			hkdfSync(
				'sha256',
				secret,
				Buffer.alloc(0),
				`terminay remote v1 ${purpose}`,
				32,
			),
		).toString('base64url');
	const relayJoinToken = derive('relay join');
	const signalingUrl = new URL(url.origin);
	signalingUrl.protocol = signalingUrl.protocol === 'http:' ? 'ws:' : 'wss:';
	signalingUrl.pathname = '/signal';
	return Object.freeze({
		appOrigin: url.origin,
		relayJoinTokenHash: createHash('sha256')
			.update(relayJoinToken)
			.digest('base64url'),
		roomId: derive('pairing room'),
		signalingUrl: signalingUrl.toString(),
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
