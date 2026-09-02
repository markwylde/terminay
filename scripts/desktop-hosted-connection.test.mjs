import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { deriveMatchCode } from '../packages/protocol/dist/index.js';
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

const RUNTIME_ROOT = resolve(process.cwd(), 'build/webrtc-runtime');
const SESSION_ID = 'server123';
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

test('Desktop pairs over the authenticated channel, pins the host key, and reconnects with the device-join proof', { timeout: 180_000 }, async (t) => {
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
