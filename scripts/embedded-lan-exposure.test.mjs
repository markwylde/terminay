import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { buildUiBundleManifest } from './build-ui-bundle-manifest.mjs';

const directory = await mkdtemp(join(tmpdir(), 'terminay-embedded-lan-'));
const localUiOutput = join(directory, 'localUiServer.cjs');
const exposureOutput = join(directory, 'serverOwnedExposure.mjs');
const bundleDirectory = join(directory, 'browser-ui');
await mkdir(bundleDirectory);
await writeFile(
	join(bundleDirectory, 'web.html'),
	'<!doctype html><title>Terminay Server UI</title>',
);
await buildUiBundleManifest({
	rootDirectory: bundleDirectory,
	serverVersion: '0.0.0',
	protocolVersion: '1',
	entryFile: 'web.html',
});
await Promise.all([
	build({
		bundle: true,
		entryPoints: ['apps/terminay-server/src/localUiServer.ts'],
		format: 'cjs',
		logLevel: 'silent',
		outfile: localUiOutput,
		platform: 'node',
		target: 'node20',
	}),
	build({
		bundle: true,
		entryPoints: ['electron/remote/serverOwnedExposure.ts'],
		format: 'esm',
		logLevel: 'silent',
		outfile: exposureOutput,
		platform: 'node',
		target: 'node20',
	}),
]);
const { createLocalUiServer } = createRequire(import.meta.url)(localUiOutput);
const { DesktopServerOwnedExposure } = await import(
	pathToFileURL(exposureOutput).href
);
test.after(async () => rm(directory, { force: true, recursive: true }));

test('embedded LAN lifecycle starts and stops its listener with server exposure', async () => {
	const events = [];
	const listener = {
		async start(input) {
			events.push(`start:${input.handoff.pairingSessionId}`);
			assert.equal(input.sessionOrigin, 'http://localhost:4319');
		},
		async stop() {
			events.push('stop');
		},
	};
	const controller = new DesktopServerOwnedExposure({
		serverId: 'desktop-server',
		sessionOrigin: 'http://localhost:4319',
		pairingMode: () => 'lan',
		lanListener: listener,
	});
	const started = await controller.toggle();
	assert.equal(started.isRunning, true);
	assert.match(started.lanPairingUrl, /[&#]pairingExpiresAt=/u);
	assert.match(started.lanPairingUrl, /pairingFlow=device/u);
	assert.match(events[0], /^start:pair-/u);
	await controller.toggle();
	assert.equal(controller.getStatus().isRunning, false);
	assert.equal(events.at(-1), 'stop');
	await controller.shutdown();
});

test('embedded LAN bind failure rolls pairing state back', async () => {
	const controller = new DesktopServerOwnedExposure({
		serverId: 'desktop-server',
		sessionOrigin: 'http://localhost:4319',
		pairingMode: () => 'lan',
		lanListener: {
			async start() {
				throw new Error('address already in use');
			},
			async stop() {},
		},
	});
	await assert.rejects(controller.toggle(), /address already in use/u);
	assert.equal(controller.getStatus().isRunning, false);
	assert.equal(controller.getStatus().pairingUrl, null);
	assert.equal(controller.exposure.pairingHandoff, undefined);
	await controller.shutdown();
});

test('local listener exposes bounded PIN pairing callbacks without bearer auth', async () => {
	const calls = [];
	let bootstrapAvailable = true;
	const server = createLocalUiServer({
		serverId: 'desktop-server',
		serverVersion: '0.0.0',
		authToken: 'bootstrap-token-123456789',
		authTokenAvailable: () => bootstrapAvailable,
		host: '127.0.0.1',
		port: 0,
		pairing: {
			start(input) {
				calls.push(['start', input]);
				return { provisionalDeviceId: 'pending-device' };
			},
			complete(input) {
				calls.push(['complete', input]);
				bootstrapAvailable = false;
				return { deviceId: 'device-a', deviceName: 'Desktop' };
			},
		},
	});
	const address = await server.start();
	try {
		const start = await fetch(`${address.origin}/api/pairing/start`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				deviceName: 'Desktop',
				pairingExpiresAt: new Date(Date.now() + 60_000).toISOString(),
				pairingPin: '123456',
				pairingSessionId: 'pair-a',
				pairingToken: 'pairing-token-123456789',
				publicKeyPem: 'PUBLIC KEY',
			}),
		});
		assert.equal(start.status, 200);
		assert.deepEqual(await start.json(), {
			provisionalDeviceId: 'pending-device',
		});
		const complete = await fetch(`${address.origin}/api/pairing/complete`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ provisionalDeviceId: 'pending-device' }),
		});
		assert.equal(complete.status, 200);
		assert.deepEqual(await complete.json(), {
			deviceId: 'device-a',
			deviceName: 'Desktop',
		});
		assert.deepEqual(
			calls.map(([kind]) => kind),
			['start', 'complete'],
		);
		const consumed = await fetch(`${address.origin}/`, {
			headers: { authorization: 'Bearer bootstrap-token-123456789' },
		});
		assert.equal(consumed.status, 503);
	} finally {
		await server.stop();
	}
});

test('verified server UI boots without URL credentials while protocol traffic remains authenticated', async () => {
	const server = createLocalUiServer({
		serverId: 'desktop-server',
		serverVersion: '0.0.0',
		authToken: 'bootstrap-token-123456789',
		host: '127.0.0.1',
		port: 0,
		rootDirectory: bundleDirectory,
	});
	const address = await server.start();
	try {
		const navigation = await fetch(`${address.origin}/`);
		assert.equal(navigation.status, 200);
		assert.match(await navigation.text(), /Terminay Server UI/u);

		const manifest = await fetch(`${address.origin}/manifest.json`);
		assert.equal(manifest.status, 200);
		assert.equal((await manifest.json()).entryPath.endsWith('/web.html'), true);

		const protocol = await fetch(`${address.origin}/protocol/stream`);
		assert.equal(protocol.status, 401);
		assert.equal(
			protocol.headers.get('www-authenticate'),
			'Bearer',
		);
	} finally {
		await server.stop();
	}
});

test('Desktop injects the matching browser bundle into its exposed listener', async () => {
	const [adapter, main, packaging] = await Promise.all([
		readFile('electron/remote/embeddedLanExposure.ts', 'utf8'),
		readFile('electron/main.ts', 'utf8'),
		readFile('electron-builder.json5', 'utf8'),
	]);
	assert.match(adapter, /rootDirectory: this\.options\.uiBundleDirectory/u);
	assert.match(main, /uiBundleDirectory: SERVER_UI_DIST/u);
	assert.match(packaging, /"dist-web"/u);
});

test('known WebRTC composition failure is visible before start', async () => {
	const reason = 'authenticated hosted signaling runtime is not installed';
	const controller = new DesktopServerOwnedExposure({
		serverId: 'desktop-server',
		sessionOrigin: 'https://session.example',
		webRtcUnavailableReason: reason,
	});
	const status = controller.getStatus();
	assert.equal(status.webRtcStatus, 'error');
	assert.equal(status.webRtcStatusMessage, reason);
	assert.equal(status.isRunning, false);
	await assert.rejects(controller.toggle(), new RegExp(reason));
	assert.equal(controller.exposure.pairingHandoff, undefined);
	await controller.shutdown();
});
