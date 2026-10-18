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
import { relaySessionId } from '../apps/terminay-server/dist/remote/directSessionId.js';
import { createDirectSignalingRelay } from '../apps/terminay-server/dist/remote/directSignalingRelay.js';
import { loadOrCreateDirectTlsCertificate } from '../apps/terminay-server/dist/remote/directTlsCertificate.js';
import { createHostedHostKey } from '../apps/terminay-server/dist/remote/hostedHostKey.js';
import { startHostedPairingHost } from '../apps/terminay-server/dist/remote/hostedPairingHost.js';
import { deriveHostedPairingSecrets } from '../apps/terminay-server/dist/remote/hostedPairingSecrets.js';
import { createServerRemoteExposure } from '../apps/terminay-server/dist/remote/serverExposure.js';
import { deriveMatchCode } from '../packages/protocol/dist/index.js';
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
const runtimeStaged = existsSync(
	resolve(RUNTIME_ROOT, 'artifact', 'lib', 'index.mjs'),
);
const directory = await mkdtemp(join(tmpdir(), 'terminay-desktop-hosted-'));
const hostedOut = join(directory, 'desktopHostedConnection.mjs');
const storeOut = join(directory, 'deviceCredentialStore.mjs');
await Promise.all([
	build({
		banner: {
			js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
		},
		bundle: true,
		entryPoints: ['electron/remote/desktopHostedConnection.ts'],
		format: 'esm',
		logLevel: 'silent',
		outfile: hostedOut,
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
const {
	connectDesktopHostedRemote,
	createDesktopApiLane,
	createDesktopConnectionStatusReporter,
	desktopHostedSignalCloseError,
	pairDesktopHostedDevice,
} = await import(pathToFileURL(hostedOut).href);
const { DesktopDeviceCredentialStore } = await import(
	pathToFileURL(storeOut).href
);
test.after(async () => rm(directory, { force: true, recursive: true }));

test('stale pairing-room close reasons give fresh-link recovery guidance', () => {
	for (const reason of [
		'unknown-room',
		'no-registered-host',
		'pairing-room-unavailable',
	]) {
		assert.match(
			desktopHostedSignalCloseError(1008, Buffer.from(reason)).message,
			/already been used or has expired/u,
		);
	}
	assert.match(desktopHostedSignalCloseError(1006, '').message, /code 1006/u);
});

test('a first ICE connection is not a recovery; only a degraded path can recover', () => {
	const reported = [];
	const status = createDesktopConnectionStatusReporter((entry) =>
		reported.push(entry),
	);
	for (const state of ['new', 'checking', 'connected', 'completed'])
		status.observe(state);
	assert.deepEqual(reported, [], 'ordinary setup reports nothing');
	status.observe('disconnected');
	status.observe('disconnected');
	status.observe('connected');
	status.observe('completed');
	status.observe('disconnected');
	status.observe('failed');
	status.observe(undefined);
	assert.deepEqual(reported, ['degraded', 'recovered', 'degraded']);
});

test('a path that stays disconnected is given up once; one that recovers in time is kept', (t) => {
	// The stall limit is the test's clock.
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const events = [];
	const status = createDesktopConnectionStatusReporter(
		(entry) => events.push(entry),
		{ limitMs: 40, onStalled: () => events.push('stalled') },
	);
	status.observe('connected');
	status.observe('disconnected');
	t.mock.timers.tick(39);
	status.observe('connected');
	t.mock.timers.tick(80);
	assert.deepEqual(events, ['degraded', 'recovered'], 'a blip is not a loss');
	status.observe('disconnected');
	status.observe('disconnected');
	t.mock.timers.tick(39);
	assert.deepEqual(events, ['degraded', 'recovered', 'degraded']);
	t.mock.timers.tick(1);
	assert.deepEqual(events, ['degraded', 'recovered', 'degraded', 'stalled']);
	t.mock.timers.tick(120);
	assert.deepEqual(events, ['degraded', 'recovered', 'degraded', 'stalled'], 'given up once');
	// An intentional close cancels the watch.
	const stopped = [];
	const closing = createDesktopConnectionStatusReporter(() => undefined, {
		limitMs: 20,
		onStalled: () => stopped.push('stalled'),
	});
	closing.observe('disconnected');
	closing.stop();
	t.mock.timers.tick(60);
	assert.deepEqual(stopped, []);
});

/** A data channel that records what it was asked to send and can be driven. */
function fakeApiChannel() {
	const listeners = new Map();
	return {
		sent: [],
		addEventListener(type, listener) {
			listeners.set(type, [...(listeners.get(type) ?? []), listener]);
		},
		send(data) {
			this.sent.push(JSON.parse(data));
		},
		emit(type, event = {}) {
			for (const listener of listeners.get(type) ?? []) listener(event);
		},
	};
}

test('a lost peer releases a pending approval wait and every pending request at once', async () => {
	const channel = fakeApiChannel();
	const lane = createDesktopApiLane(channel);
	const expiresAt = Date.now() + 10 * 60_000;
	const waiting = lane.transport.waitForEnrollmentDecision('approval-1', {
		expiresAt,
	});
	const request = lane.transport.postJson('/api/host-context', {});
	lane.fail(new Error('The connection to the server was lost before it answered.'));
	lane.fail(new Error('a later failure must not replace the first'));
	await assert.rejects(waiting, /connection to the server was lost/u);
	await assert.rejects(request, /connection to the server was lost/u);
	// Nothing can answer afterwards, so later callers fail immediately instead
	// of waiting out a timeout.
	await assert.rejects(
		lane.transport.postJson('/api/host-context', {}),
		/connection to the server was lost/u,
	);
	await assert.rejects(
		lane.transport.waitForEnrollmentDecision('approval-2', { expiresAt }),
		/connection to the server was lost/u,
	);
	assert.equal(channel.sent.length, 1);
});

test('a closed API lane releases a pending approval wait', async () => {
	const channel = fakeApiChannel();
	const lane = createDesktopApiLane(channel);
	const waiting = lane.transport.waitForEnrollmentDecision('approval-1', {
		expiresAt: Date.now() + 10 * 60_000,
	});
	channel.emit('close');
	await assert.rejects(waiting, /hosted connection closed/u);
});

test('cancelling releases a pending approval wait, and the decision still resolves an uncancelled one', async () => {
	const channel = fakeApiChannel();
	const lane = createDesktopApiLane(channel);
	const expiresAt = Date.now() + 10 * 60_000;
	const controller = new AbortController();
	const cancelled = lane.transport.waitForEnrollmentDecision('approval-1', {
		expiresAt,
		signal: controller.signal,
	});
	const decided = lane.transport.waitForEnrollmentDecision('approval-2', {
		expiresAt,
	});
	controller.abort();
	await assert.rejects(cancelled, /Desktop pairing was cancelled/u);
	await assert.rejects(
		lane.transport.waitForEnrollmentDecision('approval-3', {
			expiresAt,
			signal: controller.signal,
		}),
		/Desktop pairing was cancelled/u,
		'an already-cancelled attempt never starts waiting',
	);
	channel.emit('message', {
		data: JSON.stringify({
			type: 'enrollment-denied',
			approvalId: 'approval-2',
			reason: 'denied',
		}),
	});
	assert.equal((await decided).type, 'enrollment-denied');
});

function codec() {
	return {
		isAvailable: () => true,
		encrypt: (value) => Buffer.from(`protected:${value}`),
		decrypt: (value) => value.toString('utf8').slice('protected:'.length),
	};
}

test('Desktop pairs over the authenticated channel, pins the host key, and reconnects with the device-join proof', {
	skip: runtimeStaged
		? false
		: `selected WebRTC runtime is not staged at ${RUNTIME_ROOT}`,
}, async (t) => {
	const relay = await startHostedLoopbackRelay();
	const sessionOrigin = `http://${SESSION_ID}.localhost:${relay.port}`;
	const exposure = createServerRemoteExposure({
		serverId: 'server-a',
		sessionOrigin,
		pairingUrlFormat: 'hosted-compact',
		cleanupIntervalMs: 0,
	});
	const handoff = exposure.start();
	const hostKey = createHostedHostKey();
	const connections = [];
	const peerCloses = [];
	const peerCloseWaiters = [];
	/** Resolves once the host has reported `count` peers closed. */
	const peersClosed = (count) =>
		peerCloses.length >= count
			? Promise.resolve()
			: new Promise((resolveClosed) =>
					peerCloseWaiters.push({ count, resolve: resolveClosed }),
				);
	const host = await startHostedPairingHost({
		// The application answers every frame with the same frame, so a window
		// can prove its connection still carries traffic both ways.
		acceptApplication: (transport) => {
			let release;
			const connection = {
				connectionId: `connection-${connections.length + 1}`,
				closed: false,
				/** Settles when the host releases this connection. */
				released: new Promise((resolveRelease) => {
					release = resolveRelease;
				}),
				start: async () => {
					await transport.open();
					void (async () => {
						for await (const frame of transport.incoming)
							await transport.send(frame);
					})().catch(() => undefined);
				},
				close: async () => {
					connection.closed = true;
					release();
				},
			};
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
		// Why each peer ended, so a failed window assertion names the cause.
		onDiagnostic: (diagnostic) => {
			if (diagnostic.type !== 'peer-closed') return;
			peerCloses.push(diagnostic.reasonClass);
			for (const waiter of peerCloseWaiters.filter(
				({ count }) => peerCloses.length >= count,
			)) {
				peerCloseWaiters.splice(peerCloseWaiters.indexOf(waiter), 1);
				waiter.resolve();
			}
		},
	});
	t.after(async () => {
		await host.close();
		await exposure.shutdown();
		await relay.close();
	});
	const store = new DesktopDeviceCredentialStore({
		directory: join(directory, 'credentials'),
		codec: codec(),
	});
	// The Desktop host builds the app.terminay.com form from the handoff; here the
	// session origin is loopback so the session-origin form is used directly.
	const pairingUrl = `${sessionOrigin}/v1/?hostName=Studio-Mac#${new URL(handoff.pairingUrl).hash.slice(1)}`;
	const secrets = deriveHostedPairingSecrets(
		new URL(handoff.pairingUrl).hash.slice(1),
	);

	const shown = [];
	const candidatePairs = [];
	const statuses = [];
	const failures = [];
	const approval = pendingApproval(exposure);
	const pairing = pairDesktopHostedDevice({
		pairingUrl,
		deviceName: 'Terminay Desktop',
		store,
		webrtcRuntimeRoot: RUNTIME_ROOT,
		iceServers: [],
		signal: { connectHost: '127.0.0.1' },
		onMatchCode: approval.shown,
		onCandidatePair: (pair) => candidatePairs.push(pair),
		onConnectionStatus: (status) => statuses.push(status),
		onConnectionFailure: (reason) => failures.push(reason),
	});
	// Approve from the host side once the request is pending, after checking
	// the codes match. The host records the request and Desktop shows its
	// code; both are events, and both are waited for.
	const pending = await approval.both;
	shown.push(...approval.codes);
	assert.equal(pending.deviceName, 'Terminay Desktop');
	assert.equal(shown.length, 1);
	assert.equal(
		shown[0].matchCode,
		pending.matchCode,
		'Desktop shows the code the host shows',
	);
	exposure.approveEnrollment(pending.approvalId);
	const paired = await pairing;
	assert.equal(paired.origin, sessionOrigin);
	assert.equal(paired.serverId, 'server-a');
	assert.equal(paired.label, 'Studio-Mac');
	// The selected runtime really exposes the selected pair, and the projection
	// keeps only its route class: no address or port can appear in a diagnostic.
	assert.ok(candidatePairs.length >= 1, 'the selected candidate pair is reported');
	for (const pair of candidatePairs) {
		assert.deepEqual(Object.keys(pair).sort(), [
			'localType',
			'protocol',
			'remoteType',
			'state',
		]);
		assert.equal(pair.protocol, 'udp');
		assert.match(pair.localType, /^(?:host|srflx|prflx|relay)$/u);
		assert.match(pair.remoteType, /^(?:host|srflx|prflx|relay)$/u);
		assert.doesNotMatch(JSON.stringify(pair), /127\.0\.0\.1|\d{4,5}/u);
	}
	assert.deepEqual(statuses, [], 'a clean connect is neither degraded nor recovered');
	assert.deepEqual(
		failures,
		[],
		'closing the pairing peer after enrollment is not a connection failure',
	);
	assert.deepEqual(await store.loadPinnedHostKey(sessionOrigin), {
		algorithm: 'ed25519',
		publicKey: hostKey.publicKey,
	});
	assert.equal(exposure.devices.list().length, 1);
	const device = await store.loadDevice(sessionOrigin);
	assert.equal(device.deviceId, paired.deviceId);
	const code = await deriveMatchCode({
		pairingSecret: secrets.qrSecret,
		clientNonce: 'x'.repeat(43),
		hostPublicKey: hostKey.publicKey,
		devicePublicKeyPem: device.publicKeyPem,
	}).catch(() => 'n/a');
	assert.notEqual(
		code,
		pending.matchCode,
		'the code is nonce-bound, not a static device property',
	);
	assert.equal(
		relay.state.frames.some(
			(frame) =>
				frame.includes(secrets.pairingToken) ||
				frame.includes(secrets.qrSecret) ||
				frame.includes(pending.matchCode),
		),
		false,
		'the relay never sees pairing material or the code',
	);

	// Reconnect: device-join proof, challenge, verify, ticket, host context, all on the peer.
	const connection = await connectDesktopHostedRemote({
		origin: sessionOrigin,
		store,
		webrtcRuntimeRoot: RUNTIME_ROOT,
		expectedServerId: 'server-a',
		iceServers: [],
		signal: { connectHost: '127.0.0.1' },
	});
	t.after(() =>
		connection.transport.close({ code: 'normal' }).catch(() => undefined),
	);
	assert.equal(connection.serverId, 'server-a');
	assert.equal(connection.hostContext.serverId, 'server-a');
	assert.equal(
		connections.length,
		1,
		'the application lane was accepted with the consumed ticket',
	);
	assert.equal(relay.state.log.includes('device-join'), true);
	assert.equal(relay.state.log.includes('client-join'), true);

	// Each native window is its own connection. Two windows of this device
	// stay connected together, and beside the connection that named no window.
	const openWindow = async (windowId) => {
		const opened = await connectDesktopHostedRemote({
			origin: sessionOrigin,
			store,
			webrtcRuntimeRoot: RUNTIME_ROOT,
			expectedServerId: 'server-a',
			windowId,
			iceServers: [],
			signal: { connectHost: '127.0.0.1' },
		});
		t.after(() =>
			opened.transport.close({ code: 'normal' }).catch(() => undefined),
		);
		return opened;
	};
	await openWindow('w-main');
	const settingsWindow = await openWindow('w-settings');
	assert.equal(connections.length, 3);
	assert.deepEqual(
		connections.map((entry) => entry.closed),
		[false, false, false],
		`a second and a third window disconnect nobody (peers closed: ${peerCloses.join(', ')})`,
	);

	// A window reconnecting replaces its own connection and no other, and the
	// host says it replaced exactly one peer.
	const beforeRejoin = peerCloses.length;
	const mainWindow = await openWindow('w-main');
	await connections[1].released;
	await peersClosed(beforeRejoin + 1);
	assert.deepEqual(
		connections.map((entry) => entry.closed),
		[false, true, false, false],
		`a window reconnecting replaced another (peers closed: ${peerCloses.join(', ')})`,
	);
	assert.deepEqual(peerCloses.slice(beforeRejoin), ['replaced-by-rejoin']);
	// A window closing ends its own connection and no other: the window left
	// open keeps carrying traffic both ways for as long as it stays open.
	await settingsWindow.transport.open();
	const answers = settingsWindow.transport.incoming[Symbol.asyncIterator]();
	const roundTrip = async (value) => {
		await settingsWindow.transport.send(Uint8Array.of(value));
		const answer = await answers.next();
		assert.deepEqual([...(answer.value ?? [])], [value]);
	};
	await roundTrip(1);
	const beforeClose = peerCloses.length;
	await mainWindow.transport.close({ code: 'normal' });
	// The closed window's connection is released, and the host reports its
	// one peer closed for the lane it lost. Those are the events; what is
	// asserted follows from them, not from waiting a while. Every frame after
	// them is a round trip on the window left open, and after each one exactly
	// that one peer has closed.
	await connections[3].released;
	await peersClosed(beforeClose + 1);
	for (let value = 2; value <= 6; value += 1) {
		await roundTrip(value);
		assert.deepEqual(
			connections.map((entry) => entry.closed),
			[false, true, false, true],
			`closing one window disconnected another (peers closed: ${peerCloses.join(', ')})`,
		);
		assert.deepEqual(peerCloses.slice(beforeClose), ['required-lane-closed']);
	}
	assert.deepEqual(failures, []);
	// Which window it is never passes through the relay.
	assert.equal(
		relay.state.frames.some(
			(frame) => frame.includes('w-main') || frame.includes('w-settings'),
		),
		false,
	);

	// A different pinned key is a visible identity change, never silently accepted.
	const wrongStore = new DesktopDeviceCredentialStore({
		directory: join(directory, 'credentials-wrong'),
		codec: codec(),
	});
	const wrongKey = wrongStore.createDeviceKey(sessionOrigin);
	await wrongStore.saveDeviceIdentity({
		origin: sessionOrigin,
		deviceId: device.deviceId,
		deviceName: 'Clone',
		privateKey: wrongKey.keyRef,
		hostPin: {
			algorithm: 'ed25519',
			publicKey: randomBytes(32).toString('base64url'),
		},
	});
	await assert.rejects(
		connectDesktopHostedRemote({
			origin: sessionOrigin,
			store: wrongStore,
			webrtcRuntimeRoot: RUNTIME_ROOT,
			iceServers: [],
			signal: { connectHost: '127.0.0.1' },
		}),
		/timed out|identity|proof|failed/u,
	);
});

async function startLoopbackPairingHost(t, serverId) {
	const relay = await startHostedLoopbackRelay();
	const sessionOrigin = `http://${SESSION_ID}.localhost:${relay.port}`;
	const exposure = createServerRemoteExposure({
		serverId,
		sessionOrigin,
		pairingUrlFormat: 'hosted-compact',
		cleanupIntervalMs: 0,
	});
	const handoff = exposure.start();
	const host = await startHostedPairingHost({
		acceptApplication: () => ({
			connectionId: 'connection-1',
			start: async () => undefined,
			close: async () => undefined,
		}),
		handoff,
		hostKey: createHostedHostKey(),
		persistDevices: () => undefined,
		remote: exposure,
		serverId,
		signal: { connectHost: '127.0.0.1' },
		webrtcRuntimeRoot: RUNTIME_ROOT,
		iceServers: [],
	});
	let hostClosed = false;
	const closeHost = async () => {
		if (hostClosed) return;
		hostClosed = true;
		await host.close();
	};
	t.after(async () => {
		await closeHost();
		await exposure.shutdown();
		await relay.close();
	});
	return {
		closeHost,
		exposure,
		pairingUrl: `${sessionOrigin}/v1/?hostName=Studio-Mac#${new URL(handoff.pairingUrl).hash.slice(1)}`,
		sessionOrigin,
	};
}

/**
 * The pairing request as both sides see it: `both` resolves with the host's
 * pending approval once the host has recorded it and Desktop has shown its
 * code. Call before pairing starts, and pass `shown` as `onMatchCode`.
 */
function pendingApproval(exposure) {
	const codes = [];
	let codeShown;
	const shownCode = new Promise((resolveShown) => {
		codeShown = resolveShown;
	});
	const requested = new Promise((resolveRequested) => {
		const stop = exposure.onApprovalRequested((summary) => {
			stop();
			resolveRequested(summary);
		});
	});
	return {
		codes,
		shown: (code) => {
			codes.push(code);
			codeShown();
		},
		both: Promise.all([requested, shownCode]).then(() => {
			const [entry] = exposure.listPendingApprovals();
			assert.ok(entry, 'the recorded request is still pending');
			assert.equal(codes.length, 1);
			return entry;
		}),
	};
}

test('Desktop stops waiting for approval as soon as the pairing peer is lost, and saves nothing', {
	skip: runtimeStaged
		? false
		: `selected WebRTC runtime is not staged at ${RUNTIME_ROOT}`,
}, async (t) => {
	const { closeHost, exposure, pairingUrl, sessionOrigin } =
		await startLoopbackPairingHost(t, 'server-lost');
	const store = new DesktopDeviceCredentialStore({
		directory: join(directory, 'credentials-lost'),
		codec: codec(),
	});
	const failures = [];
	const statuses = [];
	const approval = pendingApproval(exposure);
	const pairing = pairDesktopHostedDevice({
		pairingUrl,
		deviceName: 'Terminay Desktop',
		store,
		webrtcRuntimeRoot: RUNTIME_ROOT,
		iceServers: [],
		signal: { connectHost: '127.0.0.1' },
		onMatchCode: approval.shown,
		onConnectionFailure: (reason) => failures.push(reason),
		onConnectionStatus: (status) => statuses.push(status),
		iceDisconnectLimitMs: 2_000,
	});
	const outcome = pairing.then(
		() => ({ paired: true }),
		(error) => ({ error }),
	);
	const pending = await approval.both;
	// The approval would otherwise be awaited until it expires, minutes away.
	assert.ok(approval.codes[0].expiresAt - Date.now() > 60_000);
	await closeHost();
	const result = await outcome;
	// It ends on the lost peer, not on the approval expiring: the rejection
	// says which.
	assert.ok(result.error, 'the attempt rejects instead of hanging');
	// What released the attempt is named by the rejection itself: the lost
	// peer, not the approval running out.
	assert.match(
		result.error.message,
		/connection to the server was lost/u,
	);
	assert.equal(failures.length, 1, 'the loss is reported once');
	assert.match(failures[0], /ICE stayed disconnected/u);
	assert.deepEqual(statuses, ['degraded'], 'the user saw the path degrade first');
	assert.equal(await store.loadDevice(sessionOrigin), null);
	assert.equal(exposure.devices.list().length, 0);
	assert.ok(pending.approvalId);
});

test('cancelling Desktop pairing while it awaits approval ends the attempt and withdraws the request', {
	skip: runtimeStaged
		? false
		: `selected WebRTC runtime is not staged at ${RUNTIME_ROOT}`,
}, async (t) => {
	const { exposure, pairingUrl, sessionOrigin } = await startLoopbackPairingHost(
		t,
		'server-cancel',
	);
	const store = new DesktopDeviceCredentialStore({
		directory: join(directory, 'credentials-cancel'),
		codec: codec(),
	});
	const failures = [];
	const controller = new AbortController();
	const approval = pendingApproval(exposure);
	const pairing = pairDesktopHostedDevice({
		pairingUrl,
		deviceName: 'Terminay Desktop',
		store,
		webrtcRuntimeRoot: RUNTIME_ROOT,
		iceServers: [],
		signal: { connectHost: '127.0.0.1' },
		abort: controller.signal,
		onMatchCode: approval.shown,
		onConnectionFailure: (reason) => failures.push(reason),
	});
	const outcome = pairing.then(
		() => ({ paired: true }),
		(error) => ({ error }),
	);
	const pending = await approval.both;
	// The host drops the request once its peer is gone, so nobody can approve
	// a device that is no longer asking. It says so as the request resolves.
	const withdrawn = new Promise((resolveWithdrawn) => {
		const stop = exposure.onApprovalResolved((resolution) => {
			if (resolution.approval.approvalId !== pending.approvalId) return;
			stop();
			resolveWithdrawn(resolution);
		});
	});
	controller.abort();
	const result = await outcome;
	// The cancel, and nothing slower, ended it: the rejection says so.
	assert.match(result.error?.message ?? '', /Desktop pairing was cancelled/u);
	assert.deepEqual(failures, [], 'a cancel is not a connection failure');
	assert.equal(await store.loadDevice(sessionOrigin), null);
	assert.equal((await withdrawn).outcome, 'closed');
	assert.deepEqual(exposure.listPendingApprovals(), []);
	assert.equal(exposure.devices.list().length, 0);
});

test('Desktop pairs, reconnects, and is revoked against a standalone server it reaches directly', {
	skip: runtimeStaged
		? false
		: `selected WebRTC runtime is not staged at ${RUNTIME_ROOT}`,
}, async (t) => {
	const dataRoot = await mkdtemp(join(tmpdir(), 'terminay-desktop-direct-'));
	// The advertised origin must be the port the listener answers on: the
	// upgrade boundary compares it with the Host header.
	const idle = createHttpServer();
	await new Promise((resolveListen) =>
		idle.listen(0, '127.0.0.1', resolveListen),
	);
	const directPort = idle.address().port;
	await new Promise((resolveClose) => idle.close(resolveClose));
	// A hostname, not a loopback literal: a loopback host is the connection
	// manager's own name, and the connect host below is what actually dials.
	const directOrigin = `https://box.example.test:${directPort}`;

	const certificate = await loadOrCreateDirectTlsCertificate(
		dataRoot,
		directOrigin,
	);
	const signaling = createDirectSignalingRelay({
		sessionOrigin: directOrigin,
		managerOrigin: 'https://app.example.test',
	});
	const listener = createHttpsServer({
		cert: certificate.cert,
		key: certificate.key,
	});
	listener.on('upgrade', (request, socket, head) =>
		signaling.handleUpgrade(request, socket, head),
	);
	await new Promise((resolveListen) =>
		listener.listen(directPort, '127.0.0.1', resolveListen),
	);

	const relay = await startHostedLoopbackRelay();
	const hostedOrigin = `http://${SESSION_ID}.localhost:${relay.port}`;
	const exposure = createServerRemoteExposure({
		serverId: 'server-direct',
		sessionOrigin: hostedOrigin,
		pairingUrlFormat: 'hosted-compact',
		cleanupIntervalMs: 0,
	});
	const handoff = exposure.start();
	const hostKey = createHostedHostKey();
	const fragment = new URL(handoff.pairingUrl).hash.slice(1);
	const pairingUrl = `${directOrigin}/v1/?hostName=Studio-Box#${fragment}`;
	const connections = [];
	const host = await startHostedPairingHost({
		acceptApplication: () => {
			const connection = {
				connectionId: `connection-${connections.length + 1}`,
				closed: false,
				start: async () => undefined,
				close: async () => {
					connection.closed = true;
				},
			};
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

	const store = new DesktopDeviceCredentialStore({
		directory: join(directory, 'credentials-direct'),
		codec: codec(),
	});
	const desktopSignal = { connectHost: '127.0.0.1', insecureTls: true };
	const approval = pendingApproval(exposure);
	const pairing = pairDesktopHostedDevice({
		pairingUrl,
		deviceName: 'Terminay Desktop',
		store,
		webrtcRuntimeRoot: RUNTIME_ROOT,
		iceServers: [],
		signal: desktopSignal,
		onMatchCode: approval.shown,
	});
	const pending = await approval.both;
	assert.equal(approval.codes[0].matchCode, pending.matchCode);
	exposure.approveEnrollment(pending.approvalId);
	const paired = await pairing;

	// The profile is persisted against the origin exactly as written, not a
	// hosted session origin reconstructed from a session id.
	assert.equal(paired.origin, directOrigin);
	assert.equal(paired.label, 'Studio-Box');
	assert.equal(paired.serverId, 'server-direct');
	assert.deepEqual(await store.loadPinnedHostKey(directOrigin), {
		algorithm: 'ed25519',
		publicKey: hostKey.publicKey,
	});
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
	await assert.rejects(
		connectDesktopHostedRemote({
			origin: directOrigin,
			store,
			webrtcRuntimeRoot: RUNTIME_ROOT,
			expectedServerId: 'server-direct',
			iceServers: [],
			signal: { connectHost: '127.0.0.1' },
		}),
		/timed out|revoked|denied|proof|failed|unknown/u,
	);
});
