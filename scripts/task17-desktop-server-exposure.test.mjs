import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = await mkdtemp(join(tmpdir(), 'terminay-desktop-exposure-'));
const output = join(directory, 'serverOwnedExposure.mjs');
await build({
	bundle: true,
	entryPoints: ['electron/remote/serverOwnedExposure.ts'],
	format: 'esm',
	logLevel: 'silent',
	outfile: output,
	platform: 'node',
	target: 'node20',
});
const { DesktopServerOwnedExposure } = await import(pathToFileURL(output).href);
test.after(async () => rm(directory, { force: true, recursive: true }));

test('Desktop start, status, rotate, and stop use the server-owned exposure lifecycle', async () => {
	const controller = new DesktopServerOwnedExposure({
		serverId: 'desktop-server',
	});
	assert.equal(controller.getStatus().webRtcStatus, 'not-configured');
	await assert.rejects(controller.toggle(), /Configure an HTTPS/u);
	assert.throws(
		() => controller.setPairingAddress('https://user@server.example'),
		/exact HTTPS or loopback HTTP origin/u,
	);

	const configured = controller.setPairingAddress('https://session.example');
	assert.equal(configured.origin, 'https://session.example');
	assert.equal(configured.isRunning, false);

	const started = await controller.toggle();
	assert.equal(started.isRunning, true);
	assert.equal(started.webRtcStatus, 'pairing-ready');
	const first = new URL(started.pairingUrl);
	assert.equal(first.origin, 'https://session.example');
	assert.equal(first.pathname, '/v1/');
	assert.equal(first.search, '');
	assert.match(first.hash.slice(1), /^[A-Za-z0-9_-]{32,}$/u);

	const rotated = await controller.rotate();
	assert.notEqual(rotated.webRtcRoomId, started.webRtcRoomId);
	assert.notEqual(rotated.pairingUrl, started.pairingUrl);
	assert.throws(
		() => controller.setPairingAddress('https://other.example'),
		/Stop Remote Access/u,
	);

	const stopped = await controller.toggle();
	assert.equal(stopped.isRunning, false);
	assert.equal(stopped.pairingUrl, null);
	await controller.shutdown();
});

test('Desktop hydrates its configured session origin before the first menu action', async () => {
	const controller = new DesktopServerOwnedExposure({
		serverId: 'desktop-server',
		sessionOrigin: 'https://localhost:9443',
	});
	const status = controller.getStatus();
	assert.equal(status.configurationIssue, null);
	assert.equal(status.origin, 'https://localhost:9443');
	assert.deepEqual(status.availableAddresses, ['https://localhost:9443']);
	await controller.shutdown();
});

test('Desktop projects the current configured pairing mode and LAN handoff', async () => {
	let mode = 'webrtc';
	const controller = new DesktopServerOwnedExposure({
		serverId: 'desktop-server',
		sessionOrigin: 'https://localhost:9443',
		pairingMode: () => mode,
	});
	await controller.toggle();
	assert.ok(controller.getStatus().webRtcPairingUrl);
	assert.equal(controller.getStatus().lanPairingUrl, null);

	mode = 'lan';
	const status = controller.getStatus();
	assert.equal(status.pairingMode, 'lan');
	assert.ok(status.lanPairingUrl);
	assert.equal(status.webRtcPairingUrl, null);
	await controller.shutdown();
});

test('Desktop resolves a fresh loopback WebRTC session origin when exposure starts', async () => {
	const controller = new DesktopServerOwnedExposure({
		serverId: 'desktop-server',
		sessionOrigin: 'https://localhost:9443',
		resolveSessionOrigin: () =>
			'http://0123456789abcdef0123456789abcdef.localhost:9',
	});
	const started = await controller.toggle();
	const pairingUrl = new URL(started.webRtcPairingUrl);
	assert.equal(
		pairingUrl.origin,
		'http://0123456789abcdef0123456789abcdef.localhost:9',
	);
	assert.equal(pairingUrl.pathname, '/v1/');
	await controller.shutdown();
});

test('Desktop rejects unavailable WebRTC runtime before pairing or hosted room allocation', async () => {
	let registrarCalls = 0;
	const runtimeError =
		'Desktop WebRTC runtime is unavailable in this build. Install a build with an approved production WebRTC runtime before enabling WebRTC Remote Access.';
	const controller = new DesktopServerOwnedExposure({
		serverId: 'desktop-server',
		sessionOrigin: 'https://session.example',
		ensureWebRtcRuntimeAvailable() {
			throw new Error(runtimeError);
		},
		signalingRegistrar: {
			async register() {
				registrarCalls += 1;
				throw new Error('must not allocate a hosted room');
			},
		},
	});

	await assert.rejects(controller.toggle(), new RegExp(runtimeError));
	const status = controller.getStatus();
	assert.equal(registrarCalls, 0);
	assert.equal(status.isRunning, false);
	assert.equal(status.pairingUrl, null);
	assert.equal(status.webRtcPairingUrl, null);
	assert.equal(status.webRtcRoomId, null);
	assert.equal(status.webRtcStatus, 'error');
	assert.equal(status.errorMessage, runtimeError);
	assert.equal(status.webRtcStatusMessage, runtimeError);
	assert.equal(controller.exposure.pairingHandoff, undefined);
});

test('Desktop composes selected Werift only with one authenticated hosted signaling authority', async () => {
	const events = [];
	const registrar = {
		createSignaling() {
			throw new Error('peer signaling is allocated only after authentication');
		},
		async register(handoff) {
			const registration = {
				active: true,
				roomId: handoff.roomId,
				async close() {
					registration.active = false;
					events.push(`close:${handoff.roomId}`);
				},
			};
			events.push(`register:${handoff.roomId}`);
			return registration;
		},
	};
	const controller = new DesktopServerOwnedExposure({
		serverId: 'desktop-server',
		sessionOrigin: 'https://session.example',
		ensureWebRtcRuntimeAvailable() {},
		secureWerift: {
			runtimeRoot: '/packaged/webrtc-runtime',
			signalingRegistrar: registrar,
		},
	});
	assert.equal(controller.exposure.nodeDataChannelHost.runtime, 'werift');
	const started = await controller.toggle();
	assert.equal(started.isRunning, true);
	assert.equal(events.length, 1);
	assert.match(events[0], /^register:/u);
	await controller.shutdown();
	assert.equal(events.at(-1), `close:${started.webRtcRoomId}`);

	assert.throws(
		() =>
			new DesktopServerOwnedExposure({
				serverId: 'desktop-server',
				sessionOrigin: 'https://session.example',
				signalingRegistrar: { register: registrar.register },
				secureWerift: {
					runtimeRoot: '/packaged/webrtc-runtime',
					signalingRegistrar: registrar,
				},
			}),
		/share one authority/u,
	);
});

test('Desktop verifies selected Werift before exposure or hosted room allocation', async () => {
	let registrarCalls = 0;
	const controller = new DesktopServerOwnedExposure({
		serverId: 'desktop-server',
		sessionOrigin: 'https://session.example',
		secureWerift: {
			runtimeRoot: '/missing/packaged/webrtc-runtime',
			signalingRegistrar: {
				createSignaling() {
					throw new Error('must not allocate authenticated signaling');
				},
				async register() {
					registrarCalls += 1;
					throw new Error('must not allocate a hosted room');
				},
			},
		},
	});

	await assert.rejects(controller.toggle(), /selection\.json|no such file/u);
	const status = controller.getStatus();
	assert.equal(registrarCalls, 0);
	assert.equal(status.isRunning, false);
	assert.equal(status.pairingUrl, null);
	assert.equal(status.webRtcPairingUrl, null);
	assert.equal(status.webRtcRoomId, null);
	assert.equal(status.webRtcStatus, 'error');
	assert.equal(controller.exposure.pairingHandoff, undefined);
	await controller.shutdown();
});

test('Desktop registers, atomically rotates, stops, and fails closed for hosted rooms', async () => {
	const events = [];
	const registrar = {
		async register(handoff) {
			const registration = {
				active: true,
				roomId: handoff.roomId,
				async close() {
					registration.active = false;
					events.push(`close:${handoff.roomId}`);
				},
			};
			events.push(`register:${handoff.roomId}`);
			return registration;
		},
	};
	const controller = new DesktopServerOwnedExposure({
		serverId: 'desktop-server',
		sessionOrigin: 'https://session.example',
		signalingRegistrar: registrar,
	});
	const started = await controller.toggle();
	const firstRoom = started.webRtcRoomId;
	const rotated = await controller.rotate();
	assert.notEqual(rotated.webRtcRoomId, firstRoom);
	assert.deepEqual(events, [
		`register:${firstRoom}`,
		`register:${rotated.webRtcRoomId}`,
		`close:${firstRoom}`,
	]);
	await controller.toggle();
	assert.equal(controller.getStatus().isRunning, false);
	assert.equal(events.at(-1), `close:${rotated.webRtcRoomId}`);

	const failed = new DesktopServerOwnedExposure({
		serverId: 'desktop-server',
		sessionOrigin: 'https://session.example',
		signalingRegistrar: {
			async register() {
				throw new Error('registration rejected');
			},
		},
	});
	await assert.rejects(failed.toggle(), /registration rejected/u);
	assert.equal(failed.getStatus().isRunning, false);
	assert.equal(failed.getStatus().pairingUrl, null);
});

test('Desktop main routes connection-menu exposure controls to server ownership', async () => {
	const source = await readFile(
		new URL('../electron/main.ts', import.meta.url),
		'utf8',
	);
	assert.match(
		source,
		/const desktopRemoteExposure = new DesktopServerOwnedExposure/,
	);
	assert.match(
		source,
		/sessionOrigin: readTerminalSettings\(\)\.remoteAccess\.origin/,
	);
	assert.match(
		source,
		/pairingMode: \(\) => readTerminalSettings\(\)\.remoteAccess\.pairingMode/,
	);
	assert.match(source, /resolveSessionOrigin: \(\) =>/);
	assert.match(source, /return desktopRemoteExposure\.getStatus\(\)/);
	assert.match(source, /await desktopRemoteExposure\.toggle\(\)/);
	assert.match(source, /broadcastRemoteAccessStatus\(\)/);
	assert.match(
		source,
		/await desktopRemoteExposure\.revokeDevice\(payload\.deviceId\)/,
	);
	assert.match(
		source,
		/desktopRemoteExposure\.closeConnection\(payload\.connectionId\)/,
	);
	assert.match(
		source,
		/desktopRemoteExposure\.setPairingAddress\(payload\.address\)/,
	);
	assert.match(source, /ensureWebRtcRuntimeAvailable: \(\) =>/);
	assert.match(source, /Desktop WebRTC runtime is unavailable in this build/u);
	assert.match(
		source,
		/window\.isDestroyed\(\)\s*\|\|\s*window\.webContents\.isDestroyed\(\)/,
	);
});

test('Desktop pairing modal derives QR image bytes from a server-owned one-time URL', async () => {
	const source = await readFile(
		new URL('../src/workspace/useRemoteAccessController.ts', import.meta.url),
		'utf8',
	);
	assert.match(source, /import\('qrcode'\)/);
	assert.match(source, /toDataURL\(pairingUrl/);
	assert.match(source, /pairingQrCodeDataUrl \?\? generatedQrCodeDataUrl/);
	assert.match(source, /next\?\.lanPairingUrl/);
	const settingsSource = await readFile(
		new URL('../src/components/SettingsWindow.tsx', import.meta.url),
		'utf8',
	);
	assert.match(settingsSource, /function RemotePairingQrImage/);
	assert.match(settingsSource, /module\.default\.toDataURL\(pairingUrl/);
});
