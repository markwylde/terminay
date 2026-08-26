import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assertAuthenticatedWebRtcTransportTranscript,
	verifyAuthenticatedWebRtcHostSignature,
	verifyAuthenticatedWebRtcPairingAuthenticator,
} from '@terminay/protocol';
import { createHostedHostKey } from '../dist/remote/hostedHostKey.js';
import { createAuthenticatedTransportOffer } from '../dist/remote/hostedPairingHost.js';

const fingerprint = Buffer.alloc(32, 0x77).toString('hex').match(/../g).join(':').toUpperCase();
const sdp = `v=0\r\na=fingerprint:sha-256 ${fingerprint}\r\n`;
const clientNonce = Buffer.alloc(32, 0x66).toString('base64url');

test('host signs the exact pairing offer and authenticates it from the fragment', async () => {
	const hostKey = createHostedHostKey();
	const pairingSecret = Buffer.alloc(32, 0x55).toString('base64url');
	const proof = await createAuthenticatedTransportOffer({
		hostKey,
		scope: { kind: 'pairing', roomId: 'room-12345678', clientNonce, pairingSecret },
		sdp,
		serverId: 'server-a',
		sessionOrigin: 'https://server123.terminay.com',
	});
	const transcript = await assertAuthenticatedWebRtcTransportTranscript(proof.transcript, {
		scope: 'pairing', scopeId: 'room-12345678', sessionOrigin: 'https://server123.terminay.com',
		serverId: 'server-a', clientNonce, sdp,
	});
	await verifyAuthenticatedWebRtcHostSignature(transcript, proof.hostSignature);
	await verifyAuthenticatedWebRtcPairingAuthenticator(pairingSecret, transcript, proof.pairingAuthenticator);
	assert.equal(transcript.hostPublicKey, hostKey.publicKey);
});

test('reconnect proof omits pairing material and binds the fresh client nonce', async () => {
	const proof = await createAuthenticatedTransportOffer({
		hostKey: createHostedHostKey(),
		scope: { kind: 'device', sessionId: 'server123', deviceId: 'device-12345678', clientNonce },
		sdp,
		serverId: 'server-a',
		sessionOrigin: 'https://server123.terminay.com',
	});
	assert.deepEqual(Object.keys(proof).sort(), ['hostSignature', 'transcript']);
	await assert.rejects(() => assertAuthenticatedWebRtcTransportTranscript(proof.transcript, {
		scope: 'reconnect', scopeId: 'device-12345678', sessionOrigin: 'https://server123.terminay.com',
		serverId: 'server-a', clientNonce: Buffer.alloc(32, 0x67).toString('base64url'), sdp,
	}), /another connection/);
});
