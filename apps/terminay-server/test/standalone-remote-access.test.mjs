import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { createServerRemoteExposure } from '../dist/index.js';
import { StandaloneRemoteAccess } from '../dist/remote/standaloneRemoteAccess.js';
import {
	createRemoteAccessOperations,
	publishRemoteAccessChanges,
	REMOTE_ACCESS_CHANGED_EVENT,
} from '../dist/remote/remoteAccessOperations.js';
import { selectStandaloneSessionOrigin } from '../dist/remote/sessionOrigin.js';

const MATCH_CODE = 'K7Q2M';
const DIRECT_ORIGIN = 'https://203.0.113.5:8443';

function fixture({
	configuredModes = [],
	failModes = new Set(),
	failMint = new Set(),
	assertExposable,
	rotateHostKey,
} = {}) {
	const remote = createServerRemoteExposure({
		serverId: 'server-a',
		sessionOrigin: 'https://0123456789abcdef0123456789abcdef.terminay.com',
		pairingUrlFormat: 'hosted-compact',
		cleanupIntervalMs: 0,
	});
	const initialHandoff = remote.start();
	const log = [];
	const hosts = [];
	let persisted = 0;
	let keyRotations = 0;
	const controller = new StandaloneRemoteAccess({
		remote,
		configuredModes,
		initialHandoff,
		rotateHandoff: () => remote.rotate(),
		handoffForMode: (mode, handoff) =>
			mode === 'direct'
				? {
						...handoff,
						sessionOrigin: DIRECT_ORIGIN,
						pairingUrl: `${DIRECT_ORIGIN}/v1/#direct`,
					}
				: handoff,
		startPairingHost: async (mode, input) => {
			log.push(`start:${mode}`);
			if (failModes.has(mode)) throw new Error(`${mode} signaling unreachable`);
			const host = {
				mode,
				input,
				closed: false,
				closedDevices: [],
				close: async () => {
					host.closed = true;
					log.push(`close:${mode}`);
				},
				closeDevice: async (deviceId) => {
					host.closedDevices.push(deviceId);
					return 1;
				},
				mintPairing: async () => {
					log.push(`mint:${mode}`);
					if (failMint.has(mode)) throw new Error(`${mode} mint failed`);
					await input.rotateHandoff();
				},
				waitForPairingRefresh: async () => undefined,
			};
			hosts.push(host);
			return host;
		},
		persistDevices: () => {
			persisted += 1;
		},
		rotateHostKey:
			rotateHostKey ??
			(() => {
				keyRotations += 1;
			}),
		...(assertExposable === undefined ? {} : { assertExposable }),
		responseGraceMs: 20,
	});
	let changes = 0;
	controller.onChange(() => {
		changes += 1;
	});
	return {
		remote,
		controller,
		log,
		hosts,
		initialHandoff,
		changes: () => changes,
		persisted: () => persisted,
		keyRotations: () => keyRotations,
	};
}

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

function enrollDevice(remote, name = 'Phone') {
	const { publicKey } = generateKeyPairSync('rsa', {
		modulusLength: 2048,
		publicKeyEncoding: { type: 'spki', format: 'pem' },
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
	});
	const handoff = remote.pairingHandoff;
	return remote.enrollDevice({
		pairingSessionId: handoff.pairingSessionId,
		pairingToken: handoff.pairingToken,
		deviceName: name,
		publicKeyPem: publicKey,
	});
}

function requestApproval(remote) {
	const { publicKey } = generateKeyPairSync('rsa', {
		modulusLength: 2048,
		publicKeyEncoding: { type: 'spki', format: 'pem' },
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
	});
	const handoff = remote.pairingHandoff;
	return remote.requestEnrollment({
		pairingSessionId: handoff.pairingSessionId,
		pairingToken: handoff.pairingToken,
		deviceName: 'Tablet',
		publicKeyPem: publicKey,
		matchCode: MATCH_CODE,
		peerId: 'peer-a',
	});
}

test('a server with no configured mode exposes hosted only and reports running', async () => {
	const { controller, log, initialHandoff } = fixture();
	assert.equal(controller.status().isRunning, false);
	assert.equal(controller.status().webRtcPairingUrl, null);
	const status = await controller.toggle();
	assert.deepEqual(log, ['start:hosted']);
	assert.equal(status.isRunning, true);
	assert.equal(status.webRtcPairingUrl, initialHandoff.pairingUrl);
	assert.deepEqual(controller.activeModes, ['hosted']);
});

test('a direct-only server re-exposes direct only, with no hosted attempt', async () => {
	const { controller, log } = fixture({
		configuredModes: ['direct'],
		failModes: new Set(['hosted']),
	});
	await controller.expose();
	await controller.toggle();
	await settle();
	const status = await controller.toggle();
	assert.equal(status.isRunning, true);
	assert.deepEqual(
		log.filter((entry) => entry.includes('hosted')),
		[],
		'hosted signaling is never touched',
	);
	assert.equal(status.webRtcPairingUrl, `${DIRECT_ORIGIN}/v1/#direct`);
});

test('stop answers first, then closes every mode after the grace period', async () => {
	const { controller, hosts, remote } = fixture({
		configuredModes: ['hosted', 'direct'],
	});
	await controller.expose();
	const pending = requestApproval(remote);
	assert.equal(controller.status().pendingApprovals.length, 1);
	const status = await controller.toggle();
	assert.equal(status.isRunning, false);
	assert.deepEqual(status.pendingApprovals, [], 'approvals resolve as closed');
	assert.equal(status.webRtcPairingUrl, null);
	assert.equal(
		hosts.some((host) => host.closed),
		false,
		'hosts are still open when the answer is returned',
	);
	await settle();
	assert.equal(
		hosts.every((host) => host.closed),
		true,
	);
	assert.throws(() => remote.approveEnrollment(pending.approvalId));
});

test('repeated stop and expose starts a fresh room each generation', async () => {
	const { controller, hosts } = fixture({ configuredModes: ['hosted'] });
	await controller.expose();
	const first = controller.status().webRtcPairingUrl;
	await controller.toggle();
	await controller.toggle();
	const second = controller.status().webRtcPairingUrl;
	await controller.toggle();
	await controller.toggle();
	const third = controller.status().webRtcPairingUrl;
	assert.equal(new Set([first, second, third]).size, 3);
	await settle();
	assert.equal(hosts.length, 3);
	assert.deepEqual(
		hosts.map((host) => host.closed),
		[true, true, false],
	);
});

test('a mode that fails to register closes the ones already started and stays stopped', async () => {
	const { controller, hosts } = fixture({
		configuredModes: ['hosted', 'direct'],
		failModes: new Set(['direct']),
	});
	const status = await controller.toggle();
	assert.equal(status.isRunning, false);
	assert.equal(status.errorMessage, 'direct signaling unreachable');
	assert.equal(status.webRtcStatus, 'error');
	assert.equal(hosts.length, 1);
	assert.equal(hosts[0].closed, true);
	await assert.rejects(controller.expose(), /direct signaling unreachable/);
});

test('create-pairing-link rotates once and registers the room on every mode', async () => {
	const { controller, log } = fixture({
		configuredModes: ['hosted', 'direct'],
	});
	await controller.expose();
	const before = controller.status().webRtcRoomId;
	const status = await controller.createPairingLink();
	assert.deepEqual(
		log.filter((entry) => entry.startsWith('mint:')),
		['mint:hosted', 'mint:direct'],
	);
	assert.notEqual(status.webRtcRoomId, before);
	const handoffs = controller.handoffs();
	assert.equal(
		handoffs[0].handoff.pairingSessionId,
		handoffs[1].handoff.pairingSessionId,
		'both modes advertise one room',
	);
});

test('create-pairing-link fails when a mode fails to register the room', async () => {
	const { controller } = fixture({
		configuredModes: ['hosted', 'direct'],
		failMint: new Set(['direct']),
	});
	await controller.expose();
	await assert.rejects(controller.createPairingLink(), /direct mint failed/);
	await controller.toggle();
	await assert.rejects(controller.createPairingLink(), /not exposed/);
});

test('status stays running across a room rotation', async () => {
	const { controller, hosts } = fixture({ configuredModes: ['hosted'] });
	await controller.expose();
	await hosts[0].input.rotateHandoff();
	hosts[0].input.hooks.onHandoff(controller.handoffs()[0].handoff);
	assert.equal(controller.status().isRunning, true);
});

test('unsolicited changes fire onChange and are reflected in status', async () => {
	const { controller, hosts, remote, changes } = fixture({
		configuredModes: ['hosted'],
	});
	await controller.expose();
	const counted = changes();
	requestApproval(remote);
	assert.equal(changes(), counted + 1, 'approval requested');
	const hooks = hosts[0].input.hooks;
	hooks.onPeerConnected({
		connectionId: 'conn-1',
		deviceId: 'device-1',
		deviceName: 'Phone',
		windowId: '',
		firstWindowOfDevice: true,
	});
	assert.equal(changes(), counted + 2, 'peer connected');
	assert.equal(controller.status().activeConnectionCount, 1);
	hooks.onPeerDisconnected('conn-1');
	assert.equal(changes(), counted + 3, 'peer disconnected');
	assert.equal(controller.status().activeConnectionCount, 0);
	hooks.onDevicesPersisted();
	hooks.onHandoff(controller.handoffs()[0].handoff);
	assert.equal(changes(), counted + 5, 'device persistence and handoff');
	await controller.denyDevice(
		controller.status().pendingApprovals[0].approvalId,
	);
	assert.ok(changes() >= counted + 6, 'approval resolved');
	assert.deepEqual(controller.status().pendingApprovals, []);
});

test('closing a connection closes that device on every mode and keeps it trusted', async () => {
	const { controller, hosts, remote } = fixture({
		configuredModes: ['hosted', 'direct'],
	});
	await controller.expose();
	const device = enrollDevice(remote);
	hosts[0].input.hooks.onPeerConnected({
		connectionId: 'conn-1',
		deviceId: device.deviceId,
		deviceName: 'Phone',
		windowId: '',
		firstWindowOfDevice: true,
	});
	const status = await controller.closeConnection('conn-1');
	assert.deepEqual(
		hosts.map((host) => host.closedDevices),
		[[device.deviceId], [device.deviceId]],
	);
	assert.equal(status.activeConnectionCount, 0);
	assert.equal(status.pairedDeviceCount, 1);
});

test('reset while exposed revokes every device and re-registers under the new key', async () => {
	const { controller, remote, hosts, keyRotations, persisted } = fixture({
		configuredModes: ['hosted'],
	});
	await controller.expose();
	enrollDevice(remote);
	assert.equal(controller.status().pairedDeviceCount, 1);
	const answer = await controller.resetIdentity();
	assert.equal(keyRotations(), 1);
	assert.equal(answer.pairedDeviceCount, 0);
	assert.equal(answer.isRunning, true);
	assert.equal(hosts[0].closed, false, 'nothing closes before the answer');
	await settle();
	assert.equal(persisted() >= 1, true);
	assert.equal(controller.status().pairedDeviceCount, 0);
	assert.equal(hosts[0].closed, true);
	assert.equal(hosts.length, 2, 'the mode registered again');
	assert.equal(controller.status().isRunning, true);
	assert.notEqual(controller.status().webRtcPairingUrl, null);
});

test('reset while stopped revokes and stays stopped', async () => {
	const { controller, remote, hosts } = fixture();
	enrollDevice(remote);
	await controller.resetIdentity();
	await settle();
	assert.equal(controller.status().pairedDeviceCount, 0);
	assert.equal(controller.status().isRunning, false);
	assert.equal(hosts.length, 0);
});

test('a key rotation failure changes nothing', async () => {
	const { controller, remote, hosts } = fixture({
		configuredModes: ['hosted'],
		rotateHostKey: () => {
			throw new Error('host key is not writable');
		},
	});
	await controller.expose();
	enrollDevice(remote);
	await assert.rejects(controller.resetIdentity(), /not writable/);
	await settle();
	assert.equal(controller.status().pairedDeviceCount, 1);
	assert.equal(controller.status().isRunning, true);
	assert.equal(hosts[0].closed, false);
});

test('a reset whose re-registration fails leaves exposure stopped with the error', async () => {
	const failModes = new Set();
	const { controller, remote } = fixture({
		configuredModes: ['hosted'],
		failModes,
	});
	await controller.expose();
	enrollDevice(remote);
	failModes.add('hosted');
	await controller.resetIdentity();
	await settle();
	const status = controller.status();
	assert.equal(status.isRunning, false);
	assert.equal(status.errorMessage, 'hosted signaling unreachable');
	assert.equal(status.pairedDeviceCount, 0, 'revocations stand');
});

test('expose refuses a server with no workspace UI', async () => {
	const { controller, hosts } = fixture({
		assertExposable: () => {
			throw new Error('no workspace UI configured');
		},
	});
	const status = await controller.toggle();
	assert.equal(status.isRunning, false);
	assert.equal(status.errorMessage, 'no workspace UI configured');
	assert.equal(hosts.length, 0);
});

test('operations require admin scope, validate payloads, and publish changes', async () => {
	const { controller, remote } = fixture({ configuredModes: ['hosted'] });
	const events = [];
	publishRemoteAccessChanges(controller, {
		append: (type, payload) => events.push({ type, payload }),
	});
	const operations = createRemoteAccessOperations(() => controller);
	const request = (authScope, payload = {}) => ({
		context: { authScope, clientId: 'client-1' },
		envelope: { payload },
	});
	const expected = [
		'remote-access.toggle-server',
		'remote-access.create-pairing-link',
		'remote-access.revoke-device',
		'remote-access.close-connection',
		'remote-access.approve-device',
		'remote-access.deny-device',
		'remote-access.reset-identity',
	];
	assert.deepEqual(
		Object.keys(operations.commands).sort(),
		[...expected].sort(),
	);
	assert.deepEqual(Object.keys(operations.queries), ['remote-access.status']);
	for (const name of expected) {
		await assert.rejects(
			operations.commands[name](
				request('write', { deviceId: 'x', connectionId: 'x', approvalId: 'x' }),
			),
			(error) => error.code === 'forbidden',
			name,
		);
	}
	await assert.rejects(
		operations.queries['remote-access.status'](request('read')),
		(error) => error.code === 'forbidden',
	);
	assert.equal(
		controller.status().isRunning,
		false,
		'a refused call changes nothing',
	);
	assert.deepEqual(events, []);

	const exposed = await operations.commands['remote-access.toggle-server'](
		request('admin'),
	);
	assert.equal(exposed.isRunning, true);
	assert.equal(events.at(-1).type, REMOTE_ACCESS_CHANGED_EVENT);
	await assert.rejects(
		operations.commands['remote-access.revoke-device'](request('admin', {})),
		(error) => error.code === 'validation',
	);
	const device = enrollDevice(remote);
	const revoked = await operations.commands['remote-access.revoke-device'](
		request('admin', { deviceId: device.deviceId }),
	);
	assert.equal(revoked.pairedDeviceCount, 0);
	const status = await operations.queries['remote-access.status'](
		request('admin'),
	);
	assert.equal(status.isRunning, true);
});

test('operations before the controller exists are unavailable, not unknown', async () => {
	const operations = createRemoteAccessOperations(() => undefined);
	await assert.rejects(
		operations.queries['remote-access.status']({
			context: { authScope: 'admin' },
			envelope: { payload: {} },
		}),
		(error) => error.code === 'unavailable',
	);
});

test('session origin: provisioned for hosted or no mode, kept for direct-only and explicit origins', () => {
	const base = {
		command: 'start',
		dataRoot: '/data',
		hostedDomain: 'terminay.com',
		remoteOrigin: 'https://server-a.remote.terminay.local',
		remoteOriginExplicit: false,
	};
	const provision = () => 'https://stable.terminay.com';
	assert.equal(
		selectStandaloneSessionOrigin({ ...base, exposeModes: [] }, provision),
		'https://stable.terminay.com',
	);
	assert.equal(
		selectStandaloneSessionOrigin(
			{ ...base, exposeModes: ['hosted'] },
			provision,
		),
		'https://stable.terminay.com',
	);
	assert.equal(
		selectStandaloneSessionOrigin(
			{ ...base, exposeModes: ['direct'] },
			provision,
		),
		base.remoteOrigin,
	);
	assert.equal(
		selectStandaloneSessionOrigin(
			{
				...base,
				exposeModes: [],
				remoteOrigin: 'https://explicit.example',
				remoteOriginExplicit: true,
			},
			provision,
		),
		'https://explicit.example',
	);
	assert.equal(
		selectStandaloneSessionOrigin(
			{ ...base, command: 'status', exposeModes: [] },
			provision,
		),
		base.remoteOrigin,
	);
});

test('a server not exposed at startup keeps its local fragment until a client exposes it', async () => {
	const remote = createServerRemoteExposure({
		serverId: 'server-a',
		sessionOrigin: 'https://0123456789abcdef0123456789abcdef.terminay.com',
		pairingUrlFormat: 'standalone',
		cleanupIntervalMs: 0,
	});
	const initialHandoff = remote.start();
	assert.match(new URL(initialHandoff.pairingUrl).hash, /pairingSessionId=/u);
	const started = [];
	const controller = new StandaloneRemoteAccess({
		remote,
		configuredModes: [],
		initialHandoff,
		prepareRuntimeExposure: () => remote.useHostedPairing(),
		rotateHandoff: () => remote.rotate(),
		handoffForMode: (_mode, handoff) => handoff,
		startPairingHost: async (_mode, input) => {
			started.push(input.handoff);
			return {
				close: async () => undefined,
				closeDevice: async () => 0,
				mintPairing: async () => undefined,
				waitForPairingRefresh: async () => undefined,
			};
		},
		persistDevices: () => undefined,
		rotateHostKey: () => undefined,
		responseGraceMs: 0,
	});
	const status = await controller.toggle();
	assert.equal(status.isRunning, true);
	assert.notEqual(started[0].pairingSessionId, initialHandoff.pairingSessionId);
	assert.ok(
		started[0].compactQrSecret,
		'the exposed room is a compact hosted room',
	);
	assert.equal(status.webRtcPairingUrl, started[0].pairingUrl);
});
