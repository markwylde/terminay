import { createHash, hkdfSync, randomBytes } from 'node:crypto';

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
	signalingAuthToken: string;
	signalingUrl: string;
};

const WEBRTC_PAIRING_TTL_MS = 10 * 60 * 1000;
const DEFAULT_HOSTED_DOMAIN = 'terminay.com';
const DERIVED_SECRET_BYTES = 32;
const PROTOCOL_VERSION = 'v1';

type WebRtcPairingCreateOptions = {
	hostedDomain?: string;
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

function normalizeHostedDomain(value: string): string {
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, '')
		.replace(/\/.*$/, '');
	if (
		!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
			normalized,
		)
	) {
		throw new Error('WebRTC hosted domain is invalid.');
	}
	return normalized;
}

function normalizeLocalHostedOrigin(value: string): URL | null {
	const trimmed = value.trim();
	const input = /^https?:\/\//i.test(trimmed)
		? trimmed
		: /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(trimmed)
			? `http://${trimmed}`
			: '';
	if (!input) {
		return null;
	}

	const url = new URL(input);
	if (url.pathname !== '/' || url.search || url.hash) {
		throw new Error('WebRTC local hosted origin must not include a path, query, or fragment.');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('WebRTC local hosted origin must use HTTP or HTTPS.');
	}
	if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
		throw new Error('WebRTC local hosted origin is only supported for http://localhost development servers.');
	}
	return url;
}

function createChannelUrl(channelId: string, hostedDomain?: string): URL {
	if (hostedDomain) {
		const localOrigin = normalizeLocalHostedOrigin(hostedDomain);
		if (localOrigin) {
			localOrigin.hostname = `${channelId}.${localOrigin.hostname}`;
			localOrigin.pathname = `/${PROTOCOL_VERSION}/`;
			return localOrigin;
		}
	}

	const domain = normalizeHostedDomain(hostedDomain ?? DEFAULT_HOSTED_DOMAIN);
	return new URL(`https://${channelId}.${domain}/${PROTOCOL_VERSION}/`);
}

function createSignalingUrl(appOrigin: string): string {
	const url = new URL(appOrigin);
	url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
	if (url.hostname.endsWith('.localhost')) {
		url.hostname = 'localhost';
	}
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
		const signalingAuthToken = deriveProtocolSecret(
			qrSecretBytes,
			'signaling hmac',
		);
		const assetInstallKey = deriveProtocolSecret(
			qrSecretBytes,
			'asset install',
		);
		const csrfSeed = deriveProtocolSecret(qrSecretBytes, 'csrf seed');
		const expiresAt = new Date(
			Date.now() + WEBRTC_PAIRING_TTL_MS,
		).toISOString();
		const url = createChannelUrl(sessionId, options.hostedDomain);
		const appOrigin = url.origin;
		const signalingUrl = createSignalingUrl(appOrigin);

		url.hash = qrSecret;

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
			pairingUrl: url.toString(),
			protocolVersion: PROTOCOL_VERSION,
			qrSecret,
			relayJoinToken,
			relayJoinTokenHash,
			roomId,
			sessionId,
			signalingAuthToken,
			signalingUrl,
		};
	}
}
