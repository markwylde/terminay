import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
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
	VECTOR_SCOPE_RECONNECT,
	VECTOR_SDP,
	VECTOR_SECRET,
	VECTOR_SERVER_ID,
	vectorPin,
	vectorProof,
} from './support/authenticated-webrtc-vectors.mjs';

const directory = await mkdtemp(join(tmpdir(), 'terminay-desktop-auth-webrtc-'));
const bootstrapOut = join(directory, 'desktopWebRtcBootstrap.mjs');
const storeOut = join(directory, 'deviceCredentialStore.mjs');
const gateOut = join(directory, 'desktopAuthenticatedWebRtc.mjs');
await Promise.all([
	build({
		bundle: true,
		entryPoints: ['electron/remote/desktopWebRtcBootstrap.ts'],
		external: ['ws'],
		format: 'esm',
		logLevel: 'silent',
		outfile: bootstrapOut,
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
	build({
		bundle: true,
		entryPoints: ['electron/remote/desktopAuthenticatedWebRtc.ts'],
		format: 'esm',
		logLevel: 'silent',
		outfile: gateOut,
		platform: 'node',
		target: 'node20',
	}),
]);
const { createDesktopBootstrappedWebRtcTransport } = await import(pathToFileURL(bootstrapOut).href);
const { DesktopDeviceCredentialStore } = await import(pathToFileURL(storeOut).href);
const { createDesktopAuthenticatedOfferGate, createDesktopClientNonce } = await import(pathToFileURL(gateOut).href);
test.after(async () => rm(directory, { force: true, recursive: true }));

const NOW = 2_000;
const bootstrap = () => ({
	schemaVersion: 1,
	protocolVersion: 'v1',
	role: 'offerer',
	serverId: VECTOR_SERVER_ID,
	deviceId: VECTOR_SCOPE_RECONNECT,
	peerId: 'peer-a',
	sessionOrigin: VECTOR_ORIGIN,
	signalingUrl: 'wss://server123.terminay.com/signal',
	expiresAt: 1_000_000 + 60_000,
	iceServers: [],
});

class FakeSocket extends EventEmitter {
	readyState = 0;
	sent = [];
	closed = [];
	open() {
		this.readyState = 1;
		this.emit('open');
	}
	send(data) {
		this.sent.push(data);
	}
	close(code, reason) {
		this.readyState = 3;
		this.closed.push({ code, reason });
		this.emit('close');
	}
}

function fakeTransport() {
	const listeners = [];
	return {
		async close() {},
		onStateChange(listener) {
			listeners.push(listener);
			return () => {};
		},
	};
}

function codec() {
	return {
		isAvailable: () => true,
		encrypt: (value) => Buffer.from(`protected:${value}`),
		decrypt: (value) => {
			const plain = value.toString('utf8');
			if (!plain.startsWith('protected:')) throw new Error('bad ciphertext');
			return plain.slice('protected:'.length);
		},
	};
}

test('Desktop verifies the shared pairing vectors before setRemoteDescription and pins the host key', async () => {
	const remoteDescriptions = [];
	const gate = createDesktopAuthenticatedOfferGate({
		clientNonce: VECTOR_NONCE,
		scope: 'pairing',
		scopeId: VECTOR_ROOM,
		sessionOrigin: VECTOR_ORIGIN,
		serverId: VECTOR_SERVER_ID,
		pairingSecret: VECTOR_SECRET,
		now: () => NOW,
	});
	const pin = await gate.verifyRemoteDescription(VECTOR_SDP, await vectorProof('pairing'));
	remoteDescriptions.push(VECTOR_SDP);
	assert.deepEqual(pin, vectorPin());
	assert.deepEqual(remoteDescriptions, [VECTOR_SDP]);
});

test('Desktop reconnect accepts only the pinned host key from shared vectors', async () => {
	const gate = createDesktopAuthenticatedOfferGate({
		clientNonce: VECTOR_NONCE,
		scope: 'reconnect',
		scopeId: VECTOR_SCOPE_RECONNECT,
		sessionOrigin: VECTOR_ORIGIN,
		serverId: VECTOR_SERVER_ID,
		pinnedHostKey: vectorPin(),
		now: () => NOW,
	});
	const reconnectProof = await vectorProof('reconnect');
	await gate.verifyRemoteDescription(VECTOR_SDP, reconnectProof);
	await assert.rejects(
		() => gate.verifyRemoteDescription(VECTOR_SDP, reconnectProof),
		/replayed/,
	);
});

test('Desktop signaling decode refuses a remote description without a verified transcript', async () => {
	const socket = new FakeSocket();
	await assert.rejects(
		createDesktopBootstrappedWebRtcTransport({
			bootstrap: bootstrap(),
			expectedOrigin: VECTOR_ORIGIN,
			now: () => 1_000_000,
			openSocket() {
				queueMicrotask(() => socket.open());
				return socket;
			},
			async createTransport(options) {
				const encoded = await options.signaling.encode({ type: 'answer', sdp: VECTOR_SDP });
				await options.signaling.decode(encoded);
				return fakeTransport();
			},
		}),
		/invalid fields|transport authentication|authenticatedTransport/,
	);
});

test('Desktop signaling installs SDP only after the reconnect transcript verifies', async () => {
	const socket = new FakeSocket();
	const proof = await vectorProof('reconnect');
	let installed;
	const pending = createDesktopBootstrappedWebRtcTransport({
		bootstrap: bootstrap(),
		expectedOrigin: VECTOR_ORIGIN,
		now: () => 1_000_000,
		transportAuth: {
			scope: 'reconnect',
			pinnedHostKey: vectorPin(),
			clientNonce: VECTOR_NONCE,
			now: () => NOW,
		},
		openSocket() {
			queueMicrotask(() => socket.open());
			return socket;
		},
		async createTransport(options) {
			installed = await options.signaling.decode({
				authenticatedTransport: proof,
				deviceId: VECTOR_SCOPE_RECONNECT,
				nonce: 'nonce-desktop-offer-aaaa',
				peerId: 'peer-a',
				sdp: VECTOR_SDP,
				serverId: VECTOR_SERVER_ID,
				sessionOrigin: VECTOR_ORIGIN,
				type: 'answer',
			});
			return fakeTransport();
		},
	});
	const transport = await pending;
	assert.deepEqual(installed, { type: 'answer', sdp: VECTOR_SDP });
	await transport.close();
});

test('Desktop persists the verified host pin atomically and requires it after restart', async () => {
	const root = join(directory, 'pin-records');
	const first = new DesktopDeviceCredentialStore({ directory: root, codec: codec() });
	const key = first.createDeviceKey(VECTOR_ORIGIN);
	const pin = vectorPin();
	await first.saveDeviceIdentity({
		origin: VECTOR_ORIGIN,
		deviceId: 'device-a',
		deviceName: 'Terminay Desktop',
		privateKey: key.keyRef,
		hostPin: pin,
	});
	const restarted = new DesktopDeviceCredentialStore({ directory: root, codec: codec() });
	assert.deepEqual(await restarted.loadPinnedHostKey(VECTOR_ORIGIN), pin);
	await assert.rejects(
		() => restarted.pinHostKey(VECTOR_ORIGIN, { algorithm: 'ed25519', publicKey: Buffer.alloc(32, 0x99).toString('base64url') }),
		/identity changed/,
	);
	assert.deepEqual(await restarted.loadPinnedHostKey(VECTOR_ORIGIN), pin);
});

test('Desktop nonce is a fresh 32-byte token for each connection attempt', () => {
	const first = createDesktopClientNonce();
	const second = createDesktopClientNonce();
	assert.match(first, /^[A-Za-z0-9_-]{43}$/u);
	assert.notEqual(first, second);
});
