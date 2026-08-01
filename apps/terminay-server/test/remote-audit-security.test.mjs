import assert from 'node:assert/strict';
import test from 'node:test';
import { RemoteAuditLog, RemoteConnectionManager } from '@terminay/server-core';
import { NodeDataChannelHeadlessHost, ServerRemoteExposure } from '../dist/index.js';

test('remote audit events keep retained and sinked records metadata-only', () => {
	const sinked = [];
	const audit = new RemoteAuditLog({
		serverId: 'server-a',
		now: () => 1_000,
		sink: (event) => sinked.push(event),
	});

	const event = audit.record({
		action: 'pairing-rejected',
		roomId: 'pair-room-a',
		reason: 'private-auth-secret',
		secret: 'do-not-store-this',
		applicationData: { project: 'do-not-store-this-either' },
	});

	assert.deepEqual(event, {
		action: 'pairing-rejected',
		occurredAt: 1_000,
		serverId: 'server-a',
		roomId: 'pair-room-a',
	});
	assert.deepEqual(audit.list(), [event]);
	assert.deepEqual(sinked, [event]);
	assert.equal(
		JSON.stringify(audit.list()).includes('do-not-store-this'),
		false,
	);
	assert.equal(JSON.stringify(sinked).includes('private-auth-secret'), false);
});

test('remote audit rejects unknown actions without retaining their payload', () => {
	const sinked = [];
	const audit = new RemoteAuditLog({
		serverId: 'server-a',
		sink: (event) => sinked.push(event),
	});

	assert.throws(
		() =>
			audit.record({
				action: 'provider-error-with-secret',
				secret: 'private-value',
			}),
		/remote audit action is invalid/,
	);
	assert.equal(audit.size, 0);
	assert.deepEqual(sinked, []);
});

test('remote audit keeps sinked timestamps finite and ordered across faulty clock readings', () => {
	const readings = [1_000, 999, Number.POSITIVE_INFINITY, Number.NaN, -1, 1_001];
	const sinked = [];
	const audit = new RemoteAuditLog({
		serverId: 'server-a',
		now: () => readings.shift(),
		sink: (event) => sinked.push(event),
	});

	for (let index = 0; index < 6; index += 1)
		audit.record({ action: 'cleanup' });

	assert.deepEqual(
		sinked.map((event) => event.occurredAt),
		[1_000, 1_000, 1_000, 1_000, 1_000, 1_001],
	);
	for (const event of sinked) {
		assert.equal(Number.isSafeInteger(event.occurredAt), true);
		assert.ok(event.occurredAt >= 0);
	}
});

test('a failing metadata audit sink cannot block pairing, revocation, or cleanup', async () => {
	let sinkCalls = 0;
	const exposure = new ServerRemoteExposure({
		serverId: 'server-a',
		sessionOrigin: 'https://session.example.test',
		now: () => 1_000,
		cleanupIntervalMs: 0,
		auditSink: () => {
			sinkCalls += 1;
			throw new Error('audit destination unavailable');
		},
	});

	const handoff = exposure.start(2_000);
	assert.equal(handoff.serverId, 'server-a');
	const grant = exposure.issueReconnectGrant({
		deviceId: 'device-a',
		lifetime: 'until-revoked',
	});
	assert.equal(grant.serverId, 'server-a');
	assert.equal(grant.sessionOrigin, 'https://session.example.test');
	assert.equal(typeof grant.handle, 'string');
	await exposure.revokeDevice('device-a');
	assert.doesNotThrow(() => exposure.cleanup());

	assert.ok(sinkCalls >= 4);
	assert.ok(exposure.audit.size >= 4);
	assert.equal(
		exposure.audit.list().some((event) => event.action === 'device-revoked'),
		true,
	);
	await exposure.shutdown();
});

test('server exposure hosted storage receives only serialized lifecycle metadata', async () => {
	const persistedLines = [];
	const exposure = new ServerRemoteExposure({
		serverId: 'server-a',
		sessionOrigin: 'https://session.example.test',
		now: () => 1_000,
		cleanupIntervalMs: 0,
		auditSink: (event) => persistedLines.push(JSON.stringify(event)),
	});

	const handoff = exposure.start(2_000);
	const reconnect = exposure.issueReconnectGrant({
		deviceId: 'device-a',
		lifetime: 'until-revoked',
	});
	exposure.createReconnectChallenge({
		handle: reconnect.handle,
		origin: reconnect.sessionOrigin,
		clientNonce: 'client-nonce-a',
	});
	await exposure.revokeDevice('device-a');
	exposure.stopExposure();
	exposure.cleanup();

	// Exercise the sink boundary with values that must never become retained
	// storage, even when a caller supplies them as unexpected fields.
	exposure.audit.record({
		action: 'pairing-rejected',
		roomId: handoff.roomId,
		reason: 'invalid',
		pairingSecret: handoff.secret,
		reconnectGrant: reconnect.grant,
		deviceKey: 'device-key-sentinel',
		pin: 'pin-sentinel',
		applicationData: {
			projectPath: 'project-data-sentinel',
			terminalOutput: 'terminal-data-sentinel',
		},
	});
	await exposure.shutdown();

	assert.ok(persistedLines.length >= 5);
	const persisted = persistedLines.join('\n');
	for (const forbidden of [
		handoff.secret,
		reconnect.grant,
		reconnect.handle,
		'device-key-sentinel',
		'pin-sentinel',
		'project-data-sentinel',
		'terminal-data-sentinel',
	]) {
		assert.equal(
			persisted.includes(forbidden),
			false,
			`persisted ${forbidden}`,
		);
	}

	const allowedKeys = new Set([
		'action',
		'occurredAt',
		'serverId',
		'roomId',
		'peerId',
		'deviceId',
		'reason',
	]);
	for (const line of persistedLines) {
		const event = JSON.parse(line);
		assert.ok(Object.keys(event).every((key) => allowedKeys.has(key)));
	}
});

test('hosted WebRTC metrics and cleanup reports remain aggregate-only after credential-bearing setup failure', async () => {
	let now = 1_000;
	const manager = new RemoteConnectionManager({
		serverId: 'server-a',
		sessionOrigin: 'https://session.example.test',
		now: () => now,
	});
	manager.expose(10_000);
	const signalingSecret = 'signaling-secret-sentinel';
	const ticketSecret = 'ticket-secret-sentinel';
	const host = new NodeDataChannelHeadlessHost({
		manager,
		now: () => now,
		connectionRateLimit: { maxAttempts: 3, windowMs: 10 },
		createSignaling: async () => ({
			send: () => undefined,
			onMessage: () => () => undefined,
			sign: (message) => ({ message, signalingSecret }),
			verify: () => null,
		}),
		loadModule: async () => ({
			PeerConnection: class {
				constructor() {
					throw new Error(`native setup failed with ${signalingSecret}`);
				}
			},
		}),
	});
	await assert.rejects(host.connect({
		ticketId: ticketSecret,
		serverId: 'server-a',
		sessionOrigin: 'https://session.example.test',
		deviceId: 'device-a',
		expiresAt: 9_000,
		authenticated: true,
	}), /native setup failed/u);

	const snapshot = host.snapshot;
	assert.deepEqual(Object.keys(snapshot).sort(), [
		'activeSessions',
		'connectAttempts',
		'connectedSessions',
		'failedConnections',
		'measurements',
		'pendingConnections',
		'runtime',
		'state',
	]);
	assert.equal(snapshot.runtime, 'node-datachannel');
	assert.deepEqual(Object.keys(snapshot.measurements).sort(), [
		'activeTurnCredentialRequests',
		'completedConnections',
		'iceConfigurations',
		'maxConnectionDurationMs',
		'peakActiveSessions',
		'peakActiveTurnCredentialRequests',
		'peakPendingConnections',
		'relayCapableIceConfigurations',
		'totalConnectionDurationMs',
		'turnCredentialFailures',
		'turnCredentialRequests',
	]);
	const serialized = JSON.stringify(snapshot);
	assert.equal(serialized.includes(signalingSecret), false);
	assert.equal(serialized.includes(ticketSecret), false);
	assert.equal(serialized.includes('device-a'), false);
	assert.deepEqual(host.cleanup(), {
		runtime: 'node-datachannel',
		connectionRateLimitWindows: 0,
	});
	now = 1_011;
	assert.deepEqual(host.cleanup(), {
		runtime: 'node-datachannel',
		connectionRateLimitWindows: 1,
	});
	await host.shutdown();
});
