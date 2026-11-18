import { createHash, hkdfSync, randomBytes } from 'node:crypto';
import { hostname as osHostname } from 'node:os';
import {
	formatHostedPairingUrl,
	type HostedEndpoints,
	PRODUCTION_HOSTED_ENDPOINTS,
	sessionOriginFor,
} from '@terminay/protocol';

export type WebRtcPairingPayload = {
	appOrigin: string;
	assetInstallKey: string;
	csrfSeed: string;
	expiresAt: string;
	pairing: {
		expiresAt: string;
		sessionId: string;
		token: string;
	};
	pairingUrl: string;
	protocolVersion: 'v1';
	qrSecret: string;
	relayJoinToken: string;
	relayJoinTokenHash: string;
	roomId: string;
	sessionId: string;
	signalingUrl: string;
};

const WEBRTC_PAIRING_TTL_MS = 10 * 60 * 1000;
const DERIVED_SECRET_BYTES = 32;
const PROTOCOL_VERSION = 'v1';

type WebRtcPairingCreateOptions = {
	/** App Server and Session Server (ADR-0136). Production when absent. */
	hostedEndpoints?: HostedEndpoints;
	/** Non-secret machine name shown as the default browser connection label. */
	hostName?: string;
	sessionId?: string;
};

function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('base64url');
}

function createDnsSafeChannelId(): string {
	return randomBytes(16).toString('hex');
}

function normalizeSessionId(value: string): string {
	const normalized = value.trim().toLowerCase();
	if (!/^[a-f0-9]{32}$/.test(normalized)) {
		throw new Error('WebRTC session id is invalid.');
	}
	return normalized;
}

function createChannelUrl(
	channelId: string,
	endpoints: HostedEndpoints,
): URL {
	return new URL(`/${PROTOCOL_VERSION}/`, sessionOriginFor(endpoints, channelId));
}

function createSignalingUrl(appOrigin: string): string {
	const url = new URL(appOrigin);
	url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
	url.pathname = '/signal';
	url.search = '';
	url.hash = '';
	return url.toString();
}

function deriveSecret(qrSecret: Buffer, label: string): string {
	return Buffer.from(
		hkdfSync('sha256', qrSecret, Buffer.alloc(0), label, DERIVED_SECRET_BYTES),
	).toString('base64url');
}

function deriveProtocolSecret(qrSecret: Buffer, purpose: string): string {
	return deriveSecret(qrSecret, `terminay remote ${PROTOCOL_VERSION} ${purpose}`);
}

function derivePairingRoomId(qrSecret: Buffer): string {
	return deriveProtocolSecret(qrSecret, 'pairing room');
}

function sanitizePairingHostName(value: string): string {
	let name = value.trim();
	if (name.toLowerCase().endsWith('.local')) name = name.slice(0, -'.local'.length);
	name = name.replaceAll('_', '-').slice(0, 80);
	if (
		name.length === 0 ||
		[...name].some((character) => {
			const code = character.codePointAt(0) ?? 0;
			return code < 0x20 || code === 0x7f;
		})
	) {
		return '';
	}
	return name;
}

export class WebRtcPairingManager {
	create(options: WebRtcPairingCreateOptions = {}): WebRtcPairingPayload {
		const sessionId = options.sessionId
			? normalizeSessionId(options.sessionId)
			: createDnsSafeChannelId();
		const qrSecretBytes = randomBytes(32);
		const qrSecret = qrSecretBytes.toString('base64url');
		const roomId = derivePairingRoomId(qrSecretBytes);
		const relayJoinToken = deriveProtocolSecret(qrSecretBytes, 'relay join');
		const relayJoinTokenHash = hashToken(relayJoinToken);
		const pairingToken = deriveProtocolSecret(qrSecretBytes, 'pairing');
		const assetInstallKey = deriveProtocolSecret(
			qrSecretBytes,
			'asset install',
		);
		const csrfSeed = deriveProtocolSecret(qrSecretBytes, 'csrf seed');
		const expiresAt = new Date(
			Date.now() + WEBRTC_PAIRING_TTL_MS,
		).toISOString();
		const endpoints = options.hostedEndpoints ?? PRODUCTION_HOSTED_ENDPOINTS;
		const url = createChannelUrl(sessionId, endpoints);
		const appOrigin = url.origin;
		const signalingUrl = createSignalingUrl(appOrigin);
		const hostName = sanitizePairingHostName(options.hostName ?? osHostname());
		const pairingUrl = formatHostedPairingUrl({
			fragment: qrSecret,
			hostName,
			managerOrigin: endpoints.appServer,
			pairingExpiresAt: expiresAt,
			sessionId,
		});

		return {
			appOrigin,
			assetInstallKey,
			csrfSeed,
			expiresAt,
			pairing: {
				expiresAt,
				sessionId: roomId,
				token: pairingToken,
			},
			pairingUrl,
			protocolVersion: PROTOCOL_VERSION,
			qrSecret,
			relayJoinToken,
			relayJoinTokenHash,
			roomId,
			sessionId,
			signalingUrl,
		};
	}
}
