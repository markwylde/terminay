import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createAuthenticatedWebRtcPairingAuthenticator,
	assertAuthenticatedWebRtcTransportTranscript,
	createAuthenticatedWebRtcTransportTranscript,
	extractAuthenticatedWebRtcFingerprints,
	serializeAuthenticatedWebRtcTransportTranscript,
	sha256Base64Url,
	validateAuthenticatedWebRtcTransportTranscript,
	verifyAuthenticatedWebRtcHostSignature,
	verifyAuthenticatedWebRtcPairingAuthenticator,
} from '../dist/index.js';
import { generateKeyPairSync, sign } from 'node:crypto';

const fingerprint = Array.from({ length: 32 }, (_value, index) => index.toString(16).padStart(2, '0')).join(':').toUpperCase();
const sdp = `v=0\r\na=fingerprint:sha-256 ${fingerprint}\r\n`;

async function fixture(overrides = {}) {
	return createAuthenticatedWebRtcTransportTranscript({
		scope: 'pairing', scopeId: 'room-12345678',
		sessionOrigin: 'https://server123.terminay.com', serverId: 'server-a',
		hostKeyAlgorithm: 'ed25519', hostPublicKey: 'A'.repeat(43),
		clientNonce: 'B'.repeat(43), offerId: 'C'.repeat(43),
		issuedAt: 1_000, expiresAt: 61_000,
		sdpSha256: await sha256Base64Url(sdp),
		fingerprints: extractAuthenticatedWebRtcFingerprints(sdp),
		...overrides,
	});
}

test('authenticated transport transcript has stable canonical bytes and exact SDP binding', async () => {
	const transcript = await fixture();
	const serialized = new TextDecoder().decode(serializeAuthenticatedWebRtcTransportTranscript(transcript));
	assert.equal(serialized, new TextDecoder().decode(serializeAuthenticatedWebRtcTransportTranscript(transcript)));
	assert.deepEqual(validateAuthenticatedWebRtcTransportTranscript(JSON.parse(serialized)), transcript);
	assert.equal((await assertAuthenticatedWebRtcTransportTranscript(transcript, {
		scope: 'pairing', scopeId: 'room-12345678', sessionOrigin: 'https://server123.terminay.com',
		serverId: 'server-a', clientNonce: 'B'.repeat(43), sdp, now: 2_000,
	})).offerId, 'C'.repeat(43));
	await assert.rejects(() => assertAuthenticatedWebRtcTransportTranscript(transcript, {
		scope: 'pairing', scopeId: 'room-12345678', sessionOrigin: 'https://server123.terminay.com',
		serverId: 'server-a', clientNonce: 'B'.repeat(43), sdp: `${sdp} `, now: 2_000,
	}), /offer|fingerprint/);
});

test('authenticated transport transcript rejects mutation, replay context, unsafe time, and fingerprints', async () => {
	const transcript = await fixture();
	assert.throws(() => validateAuthenticatedWebRtcTransportTranscript({ ...transcript, injected: true }), /fields/);
	assert.throws(() => validateAuthenticatedWebRtcTransportTranscript({ ...transcript, expiresAt: 500_000 }), /lifetime/);
	assert.throws(() => validateAuthenticatedWebRtcTransportTranscript({ ...transcript, fingerprints: [...transcript.fingerprints, ...transcript.fingerprints] }), /fingerprint/);
	await assert.rejects(() => assertAuthenticatedWebRtcTransportTranscript(transcript, {
		scope: 'reconnect', scopeId: 'room-12345678', sessionOrigin: 'https://server123.terminay.com',
		serverId: 'server-a', clientNonce: 'B'.repeat(43), sdp, now: 2_000,
	}), /another connection/);
	await assert.rejects(() => assertAuthenticatedWebRtcTransportTranscript(transcript, {
		scope: 'pairing', scopeId: 'room-12345678', sessionOrigin: 'https://server123.terminay.com',
		serverId: 'server-a', clientNonce: 'B'.repeat(43), sdp, now: 61_000,
	}), /expired/);
	assert.throws(() => extractAuthenticatedWebRtcFingerprints('v=0\r\n'), /fingerprint/);
	assert.throws(() => extractAuthenticatedWebRtcFingerprints('v=0\r\na=fingerprint:sha-1 AA:BB\r\n'), /unsupported/);
});

test('pairing authenticator and Ed25519 host signature verify only the exact transcript', async () => {
	const pair = generateKeyPairSync('ed25519');
	const rawPublicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url');
	const transcript = await fixture({ hostPublicKey: rawPublicKey });
	const secret = Buffer.alloc(32, 0x5a).toString('base64url');
	const authenticator = await createAuthenticatedWebRtcPairingAuthenticator(secret, transcript);
	await verifyAuthenticatedWebRtcPairingAuthenticator(secret, transcript, authenticator);
	await assert.rejects(() => verifyAuthenticatedWebRtcPairingAuthenticator(Buffer.alloc(32, 0x5b).toString('base64url'), transcript, authenticator), /authentication/);
	const signature = sign(null, Buffer.from(serializeAuthenticatedWebRtcTransportTranscript(transcript)), pair.privateKey).toString('base64url');
	await verifyAuthenticatedWebRtcHostSignature(transcript, signature);
	await assert.rejects(() => verifyAuthenticatedWebRtcHostSignature({ ...transcript, offerId: 'D'.repeat(43) }, signature), /signature/);
});
