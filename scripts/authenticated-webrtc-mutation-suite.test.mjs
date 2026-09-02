import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import {
	VECTOR_FINGERPRINT,
	VECTOR_NONCE,
	VECTOR_ORIGIN,
	VECTOR_ROOM,
	VECTOR_SDP,
	VECTOR_SECRET,
	VECTOR_SERVER_ID,
	vectorPin,
	vectorProof,
} from './support/authenticated-webrtc-vectors.mjs';

const directory = await mkdtemp(join(tmpdir(), 'terminay-webrtc-mutations-'));
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

function pairingGate(now = 2_000) {
	return createDesktopAuthenticatedOfferGate({
		clientNonce: VECTOR_NONCE,
		scope: 'pairing',
		scopeId: VECTOR_ROOM,
		sessionOrigin: VECTOR_ORIGIN,
		serverId: VECTOR_SERVER_ID,
		pairingSecret: VECTOR_SECRET,
		now: () => now,
	});
}

function reconnectGate() {
	return createDesktopAuthenticatedOfferGate({
		clientNonce: VECTOR_NONCE,
		scope: 'reconnect',
		scopeId: 'server123',
		sessionOrigin: VECTOR_ORIGIN,
		serverId: VECTOR_SERVER_ID,
		pinnedHostKey: vectorPin(),
		now: () => 2_000,
	});
}

function tweak(proof, field, value) {
	return {
		...proof,
		transcript: { ...proof.transcript, [field]: value },
	};
}

test('every independent signed-field mutation fails closed', async () => {
	const honest = await vectorProof('pairing');
	const mutations = [
		['SDP whitespace', `${VECTOR_SDP} `, honest],
		['SDP bytes', VECTOR_SDP.replace('v=0', 'v=1'), honest],
		['fingerprint', VECTOR_SDP.replace(VECTOR_FINGERPRINT, VECTOR_FINGERPRINT.replace(/^11/u, 'FF')), honest],
		['host key', VECTOR_SDP, tweak(honest, 'hostPublicKey', Buffer.alloc(32, 0x99).toString('base64url'))],
		['signature', VECTOR_SDP, { ...honest, hostSignature: Buffer.alloc(64, 0x11).toString('base64url') }],
		['pairing authenticator', VECTOR_SDP, { ...honest, pairingAuthenticator: Buffer.alloc(32, 0x11).toString('base64url') }],
		['nonce', VECTOR_SDP, tweak(honest, 'clientNonce', Buffer.alloc(32, 0x00).toString('base64url'))],
		['generation id', VECTOR_SDP, tweak(honest, 'offerId', Buffer.alloc(32, 0x01).toString('base64url'))],
		['scope', VECTOR_SDP, tweak(honest, 'scope', 'reconnect')],
		['expiry', VECTOR_SDP, tweak(honest, 'expiresAt', 1_001)],
	];
	for (const [label, sdp, proof] of mutations) {
		await assert.rejects(() => pairingGate().verifyRemoteDescription(sdp, proof), /./, label);
	}
});

test('delayed or duplicated valid messages cannot revive a retired generation', async () => {
	const gate = reconnectGate();
	const proof = await vectorProof('reconnect');
	await gate.verifyRemoteDescription(VECTOR_SDP, proof);
	await assert.rejects(() => gate.verifyRemoteDescription(VECTOR_SDP, proof), /replayed/);
	const expired = await vectorProof('pairing');
	await assert.rejects(() => pairingGate(70_000).verifyRemoteDescription(VECTOR_SDP, expired), /expired/);
});
