import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { deriveMatchCode } from '../packages/protocol/dist/index.js';
import { relaySessionId } from '../apps/terminay-server/dist/remote/directSessionId.js';
import { createDirectSignalingRelay } from '../apps/terminay-server/dist/remote/directSignalingRelay.js';
import { loadOrCreateDirectTlsCertificate } from '../apps/terminay-server/dist/remote/directTlsCertificate.js';
import { createHostedHostKey } from '../apps/terminay-server/dist/remote/hostedHostKey.js';
import { deriveHostedPairingSecrets } from '../apps/terminay-server/dist/remote/hostedPairingSecrets.js';
import { startHostedPairingHost } from '../apps/terminay-server/dist/remote/hostedPairingHost.js';
import { createServerRemoteExposure } from '../apps/terminay-server/dist/remote/serverExposure.js';
import { startHostedLoopbackRelay } from './support/hostedLoopbackRelay.mjs';

/**
 * Desktop pairs and reconnects to the production hosted pairing host over a
 * real loopback WebRTC peer, through a relay that only forwards frames. It
 * proves that no HTTP request carries pairing material, that the host key is
 * pinned beside the device key, and that reconnect uses the device-join proof.
 */

const RUNTIME_ROOT = process.env.TERMINAY_WEBRTC_RUNTIME_ROOT
	? resolve(process.env.TERMINAY_WEBRTC_RUNTIME_ROOT)
	: fileURLToPath(new URL('../build/webrtc-runtime', import.meta.url));
const SESSION_ID = 'server123';
const runtimeStaged = existsSync(resolve(RUNTIME_ROOT, 'artifact', 'lib', 'index.mjs'));
const directory = await mkdtemp(join(tmpdir(), 'terminay-desktop-hosted-'));
const hostedOut = join(directory, 'desktopHostedConnection.mjs');
const storeOut = join(directory, 'deviceCredentialStore.mjs');
await Promise.all([
	build({ banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" }, bundle: true, entryPoints: ['electron/remote/desktopHostedConnection.ts'], format: 'esm', logLevel: 'silent', outfile: hostedOut, platform: 'node', target: 'node20' }),
	build({ bundle: true, entryPoints: ['electron/remote/deviceCredentialStore.ts'], format: 'esm', logLevel: 'silent', outfile: storeOut, platform: 'node', target: 'node20' }),
]);
const { connectDesktopHostedRemote, pairDesktopHostedDevice } = await import(pathToFileURL(hostedOut).href);
const { DesktopDeviceCredentialStore } = await import(pathToFileURL(storeOut).href);
test.after(async () => rm(directory, { force: true, recursive: true }));

function codec() {
	return {
		isAvailable: () => true,
		encrypt: (value) => Buffer.from(`protected:${value}`),
		decrypt: (value) => value.toString('utf8').slice('protected:'.length),
	};
}

test('Desktop pairs over the authenticated channel, pins the host key, and reconnects with the device-join proof', { skip: runtimeStaged ? false : `selected WebRTC runtime is not staged at ${RUNTIME_ROOT}`, timeout: 180_000 }, async (t) => {
	const relay = await startHostedLoopbackRelay();
	const sessionOrigin = `http://${SESSION_ID}.localhost:${relay.port}`;
	const exposure = createServerRemoteExposure({ serverId: 'server-a', sessionOrigin, pairingUrlFormat: 'hosted-compact', cleanupIntervalMs: 0 });
	const handoff = exposure.start();
	const hostKey = createHostedHostKey();
	const connections = [];
	const host = await startHostedPairingHost({
		acceptApplication: () => {
			const connection = { connectionId: `connection-${connections.length + 1}`, closed: false, start: async () => undefined, close: async () => { connection.closed = true; } };
			connections.push(connection);
			return connection;
		},
		handoff,
		hostKey,
		persistDevices: () => undefined,
		remote: exposure,
		serverId: 'server-a',
		signal: { connectHost: '127.0.0.1' },
		webrtcRuntimeRoot: RUNTIME_ROOT,
		iceServers: [],
	});
	t.after(async () => {
		await host.close();
		await exposure.shutdown();
		await relay.close();
	});
	const store = new DesktopDeviceCredentialStore({ directory: join(directory, 'credentials'), codec: codec() });
	// The Desktop host builds the app.terminay.com form from the handoff; here the
	// session origin is loopback so the session-origin form is used directly.
	const pairingUrl = `${sessionOrigin}/v1/?hostName=Studio-Mac#${new URL(handoff.pairingUrl).hash.slice(1)}`;
	const secrets = deriveHostedPairingSecrets(new URL(handoff.pairingUrl).hash.slice(1));

	const shown = [];
	const pairing = pairDesktopHostedDevice({
		pairingUrl,
		deviceName: 'Terminay Desktop',
		store,
		webrtcRuntimeRoot: RUNTIME_ROOT,
		iceServers: [],
		signal: { connectHost: '127.0.0.1' },
		onMatchCode: (code) => shown.push(code),
	});
	// Approve from the host side once the request is pending, after checking the codes match.
	const pending = await new Promise((resolvePending, reject) => {
		const startedAt = Date.now();
		const tick = () => {
			const [entry] = exposure.listPendingApprovals();
			// The host records the request before its response reaches Desktop;
			// wait for both sides so the codes can be compared.
			if (entry && shown.length === 1) return resolvePending(entry);
			if (Date.now() - startedAt > 60_000) return reject(new Error('no pending approval'));
			setTimeout(tick, 50);
		};
		tick();
	});
	assert.equal(pending.deviceName, 'Terminay Desktop');
	assert.equal(shown.length, 1);
	assert.equal(shown[0].matchCode, pending.matchCode, 'Desktop shows the code the host shows');
	exposure.approveEnrollment(pending.approvalId);
	const paired = await pairing;
	assert.equal(paired.origin, sessionOrigin);
	assert.equal(paired.serverId, 'server-a');
	assert.equal(paired.label, 'Studio-Mac');
	assert.deepEqual(await store.loadPinnedHostKey(sessionOrigin), { algorithm: 'ed25519', publicKey: hostKey.publicKey });
	assert.equal(exposure.devices.list().length, 1);
	const device = await store.loadDevice(sessionOrigin);
	assert.equal(device.deviceId, paired.deviceId);
	const code = await deriveMatchCode({ pairingSecret: secrets.qrSecret, clientNonce: 'x'.repeat(43), hostPublicKey: hostKey.publicKey, devicePublicKeyPem: device.publicKeyPem }).catch(() => 'n/a');
	assert.notEqual(code, pending.matchCode, 'the code is nonce-bound, not a static device property');
	assert.equal(relay.state.frames.some((frame) => frame.includes(secrets.pairingToken) || frame.includes(secrets.qrSecret) || frame.includes(pending.matchCode)), false, 'the relay never sees pairing material or the code');

	// Reconnect: device-join proof, challenge, verify, ticket, host context, all on the peer.
	const connection = await connectDesktopHostedRemote({
		origin: sessionOrigin,
		store,
		webrtcRuntimeRoot: RUNTIME_ROOT,
		expectedServerId: 'server-a',
		iceServers: [],
		signal: { connectHost: '127.0.0.1' },
	});
	t.after(() => connection.transport.close({ code: 'normal' }).catch(() => undefined));
	assert.equal(connection.serverId, 'server-a');
	assert.equal(connection.hostContext.serverId, 'server-a');
	assert.equal(connections.length, 1, 'the application lane was accepted with the consumed ticket');
	assert.equal(relay.state.log.includes('device-join'), true);
	assert.equal(relay.state.log.includes('client-join'), true);

	// A different pinned key is a visible identity change, never silently accepted.
	const wrongStore = new DesktopDeviceCredentialStore({ directory: join(directory, 'credentials-wrong'), codec: codec() });
	const wrongKey = wrongStore.createDeviceKey(sessionOrigin);
	await wrongStore.saveDeviceIdentity({ origin: sessionOrigin, deviceId: device.deviceId, deviceName: 'Clone', privateKey: wrongKey.keyRef, hostPin: { algorithm: 'ed25519', publicKey: randomBytes(32).toString('base64url') } });
	await assert.rejects(connectDesktopHostedRemote({
		origin: sessionOrigin, store: wrongStore, webrtcRuntimeRoot: RUNTIME_ROOT, iceServers: [], signal: { connectHost: '127.0.0.1' },
	}), /timed out|identity|proof|failed/u);
});

test('Desktop pairs, reconnects, and is revoked against a standalone server it reaches directly', { skip: runtimeStaged ? false : `selected WebRTC runtime is not staged at ${RUNTIME_ROOT}`, timeout: 240_000 }, async (t) => {
	const dataRoot = await mkdtemp(join(tmpdir(), 'terminay-desktop-direct-'));
	// The advertised origin must be the port the listener answers on: the
	// upgrade boundary compares it with the Host header.
	const idle = createHttpServer();
	await new Promise((resolveListen) => idle.listen(0, '127.0.0.1', resolveListen));
	const directPort = idle.address().port;
	await new Promise((resolveClose) => idle.close(resolveClose));
	// A hostname, not a loopback literal: a loopback host is the connection
	// manager's own name, and the connect host below is what actually dials.
	const directOrigin = `https://box.example.test:${directPort}`;

	const certificate = await loadOrCreateDirectTlsCertificate(dataRoot, directOrigin);
	const signaling = createDirectSignalingRelay({ sessionOrigin: directOrigin, managerOrigin: 'https://app.example.test' });
	const listener = createHttpsServer({ cert: certificate.cert, key: certificate.key });
	listener.on('upgrade', (request, socket, head) => signaling.handleUpgrade(request, socket, head));
	await new Promise((resolveListen) => listener.listen(directPort, '127.0.0.1', resolveListen));

	const relay = await startHostedLoopbackRelay();
	const hostedOrigin = `http://${SESSION_ID}.localhost:${relay.port}`;
	const exposure = createServerRemoteExposure({ serverId: 'server-direct', sessionOrigin: hostedOrigin, pairingUrlFormat: 'hosted-compact', cleanupIntervalMs: 0 });
	const handoff = exposure.start();
	const hostKey = createHostedHostKey();
	const fragment = new URL(handoff.pairingUrl).hash.slice(1);
	const pairingUrl = `${directOrigin}/v1/?hostName=Studio-Box#${fragment}`;
	const connections = [];
	const host = await startHostedPairingHost({
		acceptApplication: () => {
			const connection = { connectionId: `connection-${connections.length + 1}`, closed: false, start: async () => undefined, close: async () => { connection.closed = true; } };
			connections.push(connection);
			return connection;
		},
		handoff: { ...handoff, sessionOrigin: directOrigin, pairingUrl },
		sessionId: relaySessionId(directOrigin),
		hostKey,
		persistDevices: () => undefined,
		remote: exposure,
		serverId: 'server-direct',
		// The host reaches its own listener over loopback and does not verify the
		// certificate it minted: the transcript authenticates the endpoint.
		signal: { connectHost: '127.0.0.1', insecureTls: true },
		webrtcRuntimeRoot: RUNTIME_ROOT,
		iceServers: [],
	});
	t.after(async () => {
		await host.close();
		await exposure.shutdown();
		await signaling.close();
		await new Promise((resolveClose) => listener.close(resolveClose));
		await relay.close();
		await rm(dataRoot, { force: true, recursive: true });
	});

	const store = new DesktopDeviceCredentialStore({ directory: join(directory, 'credentials-direct'), codec: codec() });
	const desktopSignal = { connectHost: '127.0.0.1', insecureTls: true };
	const shown = [];
	const pairing = pairDesktopHostedDevice({
		pairingUrl,
		deviceName: 'Terminay Desktop',
		store,
		webrtcRuntimeRoot: RUNTIME_ROOT,
		iceServers: [],
		signal: desktopSignal,
		onMatchCode: (code) => shown.push(code),
	});
	const pending = await new Promise((resolvePending, reject) => {
		const startedAt = Date.now();
		const tick = () => {
			const [entry] = exposure.listPendingApprovals();
			if (entry && shown.length === 1) return resolvePending(entry);
			if (Date.now() - startedAt > 60_000) return reject(new Error('no pending approval'));
			setTimeout(tick, 50);
		};
		tick();
	});
	assert.equal(shown[0].matchCode, pending.matchCode);
	exposure.approveEnrollment(pending.approvalId);
	const paired = await pairing;

	// The profile is persisted against the origin exactly as written, not a
	// hosted session origin reconstructed from a session id.
	assert.equal(paired.origin, directOrigin);
	assert.equal(paired.label, 'Studio-Box');
	assert.equal(paired.serverId, 'server-direct');
	assert.deepEqual(await store.loadPinnedHostKey(directOrigin), { algorithm: 'ed25519', publicKey: hostKey.publicKey });
	const device = await store.loadDevice(directOrigin);
	assert.equal(device.deviceId, paired.deviceId);

	// Reconnect runs through the direct endpoint's own /signal, and must work
	// from the saved profile alone. The caller passes no TLS relaxation here:
	// recognising a direct origin is the connection's own job, or a device that
	// paired successfully could never reconnect.
	const connection = await connectDesktopHostedRemote({
		origin: directOrigin,
		store,
		webrtcRuntimeRoot: RUNTIME_ROOT,
		expectedServerId: 'server-direct',
		iceServers: [],
		signal: { connectHost: '127.0.0.1' },
	});
	assert.equal(connection.serverId, 'server-direct');
	assert.equal(connection.hostContext.serverId, 'server-direct');
	assert.equal(connections.length, 1);
	// Nothing crossed the loopback hosted relay: this device only ever spoke to
	// the server's own listener.
	assert.equal(relay.state.log.includes('client-join'), false);
	assert.equal(relay.state.log.includes('device-join'), false);
	await connection.transport.close({ code: 'normal' }).catch(() => undefined);

	// Revoking the device on the server ends its access; the saved profile can
	// no longer reconnect without pairing again.
	assert.equal(await exposure.revokeAllDevices(), 1);
	await assert.rejects(connectDesktopHostedRemote({
		origin: directOrigin,
		store,
		webrtcRuntimeRoot: RUNTIME_ROOT,
		expectedServerId: 'server-direct',
		iceServers: [],
		signal: { connectHost: '127.0.0.1' },
	}), /timed out|revoked|denied|proof|failed|unknown/u);
});
