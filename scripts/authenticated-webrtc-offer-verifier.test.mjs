import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import {
	createAuthenticatedWebRtcPairingAuthenticator,
	createAuthenticatedWebRtcTransportTranscript,
	extractAuthenticatedWebRtcFingerprints,
	serializeAuthenticatedWebRtcTransportTranscript,
	sha256Base64Url,
} from '../packages/protocol/dist/index.js';

const directory = await mkdtemp(join(tmpdir(), 'terminay-authenticated-offer-'));
const bundle = join(directory, 'verifier.mjs');
await build({ bundle: true, entryPoints: [new URL('../src/remote/services/authenticatedWebRtcTransport.ts', import.meta.url).pathname], format: 'esm', outfile: bundle, platform: 'browser', target: 'es2022' });
const { AuthenticatedWebRtcOfferVerifier } = await import(bundle);
test.after(() => rm(directory, { recursive: true, force: true }));

const fingerprint = Buffer.alloc(32, 0x11).toString('hex').match(/../g).join(':').toUpperCase();
const sdp = `v=0\r\na=fingerprint:sha-256 ${fingerprint}\r\n`;
const key = generateKeyPairSync('ed25519');
const hostPublicKey = key.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url');
const secret = Buffer.alloc(32, 0x22).toString('base64url');

async function proof(scope, offerId = Buffer.alloc(32, scope === 'pairing' ? 0x33 : 0x44).toString('base64url')) {
	const transcript = createAuthenticatedWebRtcTransportTranscript({
		scope, scopeId: scope === 'pairing' ? 'room-12345678' : 'server123',
		sessionOrigin: 'https://server123.terminay.com', serverId: 'server-a',
		hostKeyAlgorithm: 'ed25519', hostPublicKey, clientNonce: Buffer.alloc(32, 0x55).toString('base64url'),
		offerId, issuedAt: 1_000, expiresAt: 61_000, sdpSha256: await sha256Base64Url(sdp),
		fingerprints: extractAuthenticatedWebRtcFingerprints(sdp),
	});
	return {
		transcript,
		hostSignature: sign(null, Buffer.from(serializeAuthenticatedWebRtcTransportTranscript(transcript)), key.privateKey).toString('base64url'),
		...(scope === 'pairing' ? { pairingAuthenticator: await createAuthenticatedWebRtcPairingAuthenticator(secret, transcript) } : {}),
	};
}

test('pairing authenticates and returns the exact host pin before reconnect accepts it', async () => {
	const verifier = new AuthenticatedWebRtcOfferVerifier();
	const pin = await verifier.verifyPairing({ proof: await proof('pairing'), pairingSecret: secret, scopeId: 'room-12345678', sessionOrigin: 'https://server123.terminay.com', serverId: 'server-a', clientNonce: Buffer.alloc(32, 0x55).toString('base64url'), sdp, now: 2_000 });
	assert.deepEqual(pin, { algorithm: 'ed25519', publicKey: hostPublicKey });
	await verifier.verifyReconnect({ proof: await proof('reconnect'), pinnedHostKey: pin, scopeId: 'server123', sessionOrigin: 'https://server123.terminay.com', serverId: 'server-a', clientNonce: Buffer.alloc(32, 0x55).toString('base64url'), sdp, now: 2_000 });
});

test('host substitution, SDP mutation, missing pairing authentication, and replay fail closed', async () => {
	const pairingProof = await proof('pairing');
	await assert.rejects(() => new AuthenticatedWebRtcOfferVerifier().verifyPairing({ proof: pairingProof, pairingSecret: secret, scopeId: 'room-12345678', sessionOrigin: 'https://server123.terminay.com', serverId: 'server-a', clientNonce: Buffer.alloc(32, 0x55).toString('base64url'), sdp: `${sdp} `, now: 2_000 }), /offer/);
	await assert.rejects(() => new AuthenticatedWebRtcOfferVerifier().verifyPairing({ proof: { transcript: pairingProof.transcript, hostSignature: pairingProof.hostSignature }, pairingSecret: secret, scopeId: 'room-12345678', sessionOrigin: 'https://server123.terminay.com', serverId: 'server-a', clientNonce: Buffer.alloc(32, 0x55).toString('base64url'), sdp, now: 2_000 }), /fields/);
	const verifier = new AuthenticatedWebRtcOfferVerifier();
	const reconnectProof = await proof('reconnect');
	const options = { proof: reconnectProof, pinnedHostKey: { algorithm: 'ed25519', publicKey: hostPublicKey }, scopeId: 'server123', sessionOrigin: 'https://server123.terminay.com', serverId: 'server-a', clientNonce: Buffer.alloc(32, 0x55).toString('base64url'), sdp, now: 2_000 };
	await verifier.verifyReconnect(options);
	await assert.rejects(() => verifier.verifyReconnect(options), /replayed/);
	await assert.rejects(() => new AuthenticatedWebRtcOfferVerifier().verifyReconnect({ ...options, pinnedHostKey: { algorithm: 'ed25519', publicKey: Buffer.alloc(32, 0x99).toString('base64url') } }), /identity changed/);
});
