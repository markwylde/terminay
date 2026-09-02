import { generateKeyPairSync, sign } from 'node:crypto';
import {
	createAuthenticatedWebRtcPairingAuthenticator,
	createAuthenticatedWebRtcTransportTranscript,
	extractAuthenticatedWebRtcFingerprints,
	serializeAuthenticatedWebRtcTransportTranscript,
	sha256Base64Url,
} from '../../packages/protocol/dist/index.js';

export const VECTOR_FINGERPRINT = Buffer.alloc(32, 0x11).toString('hex').match(/../g).join(':').toUpperCase();
export const VECTOR_SDP = `v=0\r\na=fingerprint:sha-256 ${VECTOR_FINGERPRINT}\r\n`;
export const VECTOR_SECRET = Buffer.alloc(32, 0x22).toString('base64url');
export const VECTOR_NONCE = Buffer.alloc(32, 0x55).toString('base64url');
export const VECTOR_ORIGIN = 'https://server123.terminay.com';
export const VECTOR_SERVER_ID = 'server-a';
export const VECTOR_ROOM = 'room-12345678';
export const VECTOR_SCOPE_RECONNECT = 'server123';

const key = generateKeyPairSync('ed25519');
export const VECTOR_HOST_PUBLIC_KEY = key.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url');

export function vectorHostKey() {
	return key;
}

export async function vectorProof(scope, overrides = {}) {
	const offerId = overrides.offerId ?? Buffer.alloc(32, scope === 'pairing' ? 0x33 : 0x44).toString('base64url');
	const sdp = overrides.sdp ?? VECTOR_SDP;
	const transcript = createAuthenticatedWebRtcTransportTranscript({
		scope,
		scopeId: overrides.scopeId ?? (scope === 'pairing' ? VECTOR_ROOM : VECTOR_SCOPE_RECONNECT),
		sessionOrigin: overrides.sessionOrigin ?? VECTOR_ORIGIN,
		serverId: overrides.serverId ?? VECTOR_SERVER_ID,
		hostKeyAlgorithm: 'ed25519',
		hostPublicKey: overrides.hostPublicKey ?? VECTOR_HOST_PUBLIC_KEY,
		clientNonce: overrides.clientNonce ?? VECTOR_NONCE,
		offerId,
		issuedAt: overrides.issuedAt ?? 1_000,
		expiresAt: overrides.expiresAt ?? 61_000,
		sdpSha256: overrides.sdpSha256 ?? await sha256Base64Url(sdp),
		fingerprints: overrides.fingerprints ?? extractAuthenticatedWebRtcFingerprints(sdp),
	});
	return {
		transcript,
		hostSignature: overrides.hostSignature ?? sign(null, Buffer.from(serializeAuthenticatedWebRtcTransportTranscript(transcript)), key.privateKey).toString('base64url'),
		...(scope === 'pairing'
			? { pairingAuthenticator: overrides.pairingAuthenticator ?? await createAuthenticatedWebRtcPairingAuthenticator(overrides.pairingSecret ?? VECTOR_SECRET, transcript) }
			: {}),
	};
}

export function vectorPin() {
	return Object.freeze({ algorithm: 'ed25519', publicKey: VECTOR_HOST_PUBLIC_KEY });
}
