import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import {
	createAuthenticatedWebRtcPairingAuthenticator,
	createAuthenticatedWebRtcTransportTranscript,
	extractAuthenticatedWebRtcFingerprints,
	serializeAuthenticatedWebRtcTransportTranscript,
	sha256Base64Url,
} from '../packages/protocol/dist/index.js';
import {
	VECTOR_NONCE,
	VECTOR_ORIGIN,
	VECTOR_ROOM,
	VECTOR_SDP,
	VECTOR_SECRET,
	VECTOR_SERVER_ID,
	vectorProof,
} from './support/authenticated-webrtc-vectors.mjs';

const directory = await mkdtemp(join(tmpdir(), 'terminay-adversarial-webrtc-'));
const output = join(directory, 'gate.mjs');
await build({
	bundle: true,
	entryPoints: ['electron/remote/desktopAuthenticatedWebRtc.ts'],
	format: 'esm',
	logLevel: 'silent',
	outfile: output,
	platform: 'node',
	target: 'node20',
});
const { createDesktopAuthenticatedOfferGate } = await import(pathToFileURL(output).href);
test.after(async () => rm(directory, { force: true, recursive: true }));

const OTHER_FINGERPRINT = Buffer.alloc(32, 0xee).toString('hex').match(/../g).join(':').toUpperCase();
const OTHER_SDP = `v=0\r\na=fingerprint:sha-256 ${OTHER_FINGERPRINT}\r\n`;

async function independentHostProof(scope) {
	const key = generateKeyPairSync('ed25519');
	const hostPublicKey = key.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url');
	const sdp = OTHER_SDP;
	const transcript = createAuthenticatedWebRtcTransportTranscript({
		scope,
		scopeId: scope === 'pairing' ? VECTOR_ROOM : 'server123',
		sessionOrigin: VECTOR_ORIGIN,
		serverId: VECTOR_SERVER_ID,
		hostKeyAlgorithm: 'ed25519',
		hostPublicKey,
		clientNonce: VECTOR_NONCE,
		offerId: Buffer.alloc(32, 0x77).toString('base64url'),
		issuedAt: 1_000,
		expiresAt: 61_000,
		sdpSha256: await sha256Base64Url(sdp),
		fingerprints: extractAuthenticatedWebRtcFingerprints(sdp),
	});
	return {
		sdp,
		proof: {
			transcript,
			hostSignature: sign(null, Buffer.from(serializeAuthenticatedWebRtcTransportTranscript(transcript)), key.privateKey).toString('base64url'),
			...(scope === 'pairing'
				? { pairingAuthenticator: await createAuthenticatedWebRtcPairingAuthenticator(VECTOR_SECRET, transcript) }
				: {}),
		},
	};
}

function embargo() {
	const sent = [];
	return {
		sent,
		send(kind) {
			sent.push(kind);
		},
	};
}

test('endpoint substitution fails before PIN, device key, signature, ticket, bundle, or application frame', async () => {
	const channel = embargo();
	const honest = await vectorProof('pairing');
	const attacker = await independentHostProof('pairing');
	const gate = createDesktopAuthenticatedOfferGate({
		clientNonce: VECTOR_NONCE,
		scope: 'pairing',
		scopeId: VECTOR_ROOM,
		sessionOrigin: VECTOR_ORIGIN,
		serverId: VECTOR_SERVER_ID,
		pairingSecret: VECTOR_SECRET,
		now: () => 2_000,
	});
	await assert.rejects(
		() => gate.verifyRemoteDescription(attacker.sdp, honest),
		/offer|fingerprint|signature|authenticator|connection/,
	);
	await assert.rejects(
		() => gate.verifyRemoteDescription(VECTOR_SDP, attacker.proof),
		/offer|fingerprint|signature|authenticator|connection|fields/,
	);
	assert.deepEqual(channel.sent, []);
});

test('two independent WebRTC connections cannot be spliced while relaying valid pairing or reconnect challenges', async () => {
	const channel = embargo();
	const pairingA = await vectorProof('pairing');
	const reconnectB = await independentHostProof('reconnect');
	const pairingGate = createDesktopAuthenticatedOfferGate({
		clientNonce: VECTOR_NONCE,
		scope: 'pairing',
		scopeId: VECTOR_ROOM,
		sessionOrigin: VECTOR_ORIGIN,
		serverId: VECTOR_SERVER_ID,
		pairingSecret: VECTOR_SECRET,
		now: () => 2_000,
	});
	await pairingGate.verifyRemoteDescription(VECTOR_SDP, pairingA);
	const reconnectGate = createDesktopAuthenticatedOfferGate({
		clientNonce: VECTOR_NONCE,
		scope: 'reconnect',
		scopeId: 'server123',
		sessionOrigin: VECTOR_ORIGIN,
		serverId: VECTOR_SERVER_ID,
		pinnedHostKey: { algorithm: 'ed25519', publicKey: pairingA.transcript.hostPublicKey },
		now: () => 2_000,
	});
	await assert.rejects(
		() => reconnectGate.verifyRemoteDescription(reconnectB.sdp, reconnectB.proof),
		/identity changed|fingerprint|offer|connection/,
	);
	assert.equal(channel.sent.includes('pin'), false);
	assert.equal(channel.sent.includes('device-key'), false);
	assert.equal(channel.sent.includes('device-signature'), false);
	assert.equal(channel.sent.includes('ticket'), false);
	assert.equal(channel.sent.includes('bundle'), false);
	assert.equal(channel.sent.includes('application-frame'), false);
});
