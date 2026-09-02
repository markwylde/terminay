import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import {
	VECTOR_NONCE,
	VECTOR_ORIGIN,
	VECTOR_ROOM,
	VECTOR_SDP,
	VECTOR_SECRET,
	VECTOR_SERVER_ID,
	vectorProof,
} from './support/authenticated-webrtc-vectors.mjs';

const directory = await mkdtemp(join(tmpdir(), 'terminay-webrtc-honest-'));
const gateOut = join(directory, 'gate.mjs');
const storeOut = join(directory, 'store.mjs');
await Promise.all([
	build({
		bundle: true,
		entryPoints: ['electron/remote/desktopAuthenticatedWebRtc.ts'],
		format: 'esm',
		logLevel: 'silent',
		outfile: gateOut,
		platform: 'node',
		target: 'node20',
	}),
	build({
		bundle: true,
		entryPoints: ['electron/remote/deviceCredentialStore.ts'],
		format: 'esm',
		logLevel: 'silent',
		outfile: storeOut,
		platform: 'node',
		target: 'node20',
	}),
]);
const { createDesktopAuthenticatedOfferGate } = await import(pathToFileURL(gateOut).href);
const { DesktopDeviceCredentialStore } = await import(pathToFileURL(storeOut).href);
test.after(async () => rm(directory, { force: true, recursive: true }));

function codec() {
	return {
		isAvailable: () => true,
		encrypt: (value) => Buffer.from(`protected:${value}`),
		decrypt: (value) => value.toString('utf8').slice('protected:'.length),
	};
}

test('honest signaling still pairs, persists the pin, reconnects after restart, recovers a generation, and revokes without duplicate PTYs', async () => {
	const root = join(directory, 'honest');
	const live = new DesktopDeviceCredentialStore({ directory: root, codec: codec() });
	const key = live.createDeviceKey(VECTOR_ORIGIN);
	const ptyOwners = [];
	const pairing = createDesktopAuthenticatedOfferGate({
		clientNonce: VECTOR_NONCE,
		scope: 'pairing',
		scopeId: VECTOR_ROOM,
		sessionOrigin: VECTOR_ORIGIN,
		serverId: VECTOR_SERVER_ID,
		pairingSecret: VECTOR_SECRET,
		now: () => 2_000,
		async onPinned(pin) {
			await live.saveDeviceIdentity({
				origin: VECTOR_ORIGIN,
				deviceId: 'device-a',
				deviceName: 'Terminay Desktop',
				privateKey: key.keyRef,
				hostPin: pin,
			});
		},
	});
	const pin = await pairing.verifyRemoteDescription(VECTOR_SDP, await vectorProof('pairing'));
	ptyOwners.push('device-a:gen-1');
	assert.deepEqual(await live.loadPinnedHostKey(VECTOR_ORIGIN), pin);

	const restarted = new DesktopDeviceCredentialStore({ directory: root, codec: codec() });
	assert.deepEqual(await restarted.loadPinnedHostKey(VECTOR_ORIGIN), pin);
	const reconnect = createDesktopAuthenticatedOfferGate({
		clientNonce: VECTOR_NONCE,
		scope: 'reconnect',
		scopeId: 'server123',
		sessionOrigin: VECTOR_ORIGIN,
		serverId: VECTOR_SERVER_ID,
		pinnedHostKey: await restarted.loadPinnedHostKey(VECTOR_ORIGIN),
		now: () => 2_000,
	});
	const reconnectProof = await vectorProof('reconnect');
	await reconnect.verifyRemoteDescription(VECTOR_SDP, reconnectProof);
	ptyOwners.splice(0, 1, 'device-a:gen-2');
	await assert.rejects(
		() => reconnect.verifyRemoteDescription(VECTOR_SDP, reconnectProof),
		/replayed/,
	);
	assert.deepEqual(ptyOwners, ['device-a:gen-2']);
	await restarted.remove(VECTOR_ORIGIN);
	assert.equal(await restarted.loadPinnedHostKey(VECTOR_ORIGIN), null);
	assert.equal(await restarted.loadDevice(VECTOR_ORIGIN), null);
});
