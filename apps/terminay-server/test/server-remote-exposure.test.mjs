import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createServerRemoteExposure,
	createStandaloneServer,
} from '../dist/index.js';
import { createRemoteReconnectProof } from '@terminay/server-core';

const CHANNELS = ['control', 'application', 'terminal', 'assets'];

class FakeChannel {
	constructor(label) {
		this.label = label;
		this.open = true;
		this.closed = new Set();
	}
	getLabel() {
		return this.label;
	}
	isOpen() {
		return this.open;
	}
	bufferedAmount() {
		return 0;
	}
	sendMessageBinary() {
		return this.open;
	}
	onMessage() {}
	onClosed(listener) {
		this.closed.add(listener);
	}
	close() {
		if (!this.open) return;
		this.open = false;
		for (const listener of [...this.closed]) listener();
	}
}

class FakePeer {
	static instances = [];
	constructor() {
		this.channels = new Map();
		this.closed = false;
		FakePeer.instances.push(this);
	}
	onLocalDescription(listener) {
		this.description = listener;
	}
	onLocalCandidate(listener) {
		this.candidate = listener;
	}
	onStateChange(listener) {
		this.state = listener;
	}
	onDataChannel(listener) {
		this.dataChannel = listener;
	}
	setRemoteDescription(sdp, type) {
		this.remoteDescription = { sdp, type };
		this.description?.('answer-sdp', 'answer');
		for (const label of CHANNELS) {
			const channel = new FakeChannel(label);
			this.channels.set(label, channel);
			this.dataChannel?.(channel);
		}
	}
	addRemoteCandidate() {}
	close() {
		this.closed = true;
	}
}

function proof(deviceId = 'device-a', ticketId = `${deviceId}-ticket`) {
	return {
		ticketId,
		serverId: 'server-a',
		sessionOrigin: 'https://session.example.test',
		deviceId,
		expiresAt: 900,
		authenticated: true,
	};
}

function signalingFixture() {
	const connections = [];
	return {
		connections,
		createSignaling() {
			const inbound = [];
			const outbound = [];
			let closed = false;
			const value = {
				inbound,
				outbound,
				signaling: {
					send: (message) => outbound.push(message),
					onMessage(listener) {
						inbound.push(listener);
						return () => inbound.splice(inbound.indexOf(listener), 1);
					},
					sign: (message) => ({ ...message, signature: 'valid' }),
					verify: (message) =>
						message?.signature === 'valid'
							? {
									type: message.type,
									...(message.sdp === undefined
										? { candidate: message.candidate, mid: message.mid }
										: { sdp: message.sdp }),
								}
							: null,
					close: () => {
						closed = true;
					},
				},
				isClosed: () => closed,
			};
			connections.push(value);
			return value.signaling;
		},
	};
}

test('server runtime composes node-datachannel lifecycle, rotates rooms, and revokes grants', async () => {
	FakePeer.instances.length = 0;
	const relay = signalingFixture();
	const now = 100;
	const service = createServerRemoteExposure({
		serverId: 'server-a',
		sessionOrigin: 'https://session.example.test',
		now: () => now,
		cleanupIntervalMs: 0,
		nodeDataChannel: {
			module: { PeerConnection: FakePeer },
			createSignaling: relay.createSignaling,
			role: 'answerer',
		},
	});
	const runtime = createStandaloneServer({
		serverId: 'server-a',
		serverVersion: '1.0.0',
		dataRoot: '/tmp/terminay-remote-runtime',
		services: { remoteExposure: service },
	});

	await runtime.start();
	assert.equal(service.status.exposure.state, 'disabled');
	const first = service.start(500);
	const grant = service.issueReconnectGrant({
		deviceId: 'device-a',
		lifetime: 'until-revoked',
	});
	const attempt = {
		roomId: first.roomId,
		serverId: first.serverId,
		sessionOrigin: first.sessionOrigin,
		secret: first.secret,
	};
	const pending = service.connectHeadless(attempt, proof());
	await new Promise((resolve) => setImmediate(resolve));
	relay.connections[0].inbound[0]({
		type: 'offer',
		sdp: 'offer-sdp',
		signature: 'valid',
	});
	const session = await pending;

	assert.equal(service.status.sessions.length, 1);
	assert.equal(runtime.diagnostics().remoteExposure.headlessSessions, 1);
	assert.equal(
		service.audit.list().some((event) => event.action === 'peer-connected'),
		true,
	);
	const firstPairingUrl = new URL(first.pairingUrl);
	const firstBootstrap = new URLSearchParams(firstPairingUrl.hash.slice(1));
	assert.equal(firstBootstrap.get('pairingSessionId'), first.pairingSessionId);
	assert.equal(firstBootstrap.get('pairingToken'), first.pairingToken);
	assert.equal(firstBootstrap.get('pairingExpiresAt'), first.pairingExpiresAt);
	assert.equal(firstPairingUrl.search, '');

	const rotated = service.rotate(600);
	assert.notEqual(rotated.roomId, first.roomId);
	assert.equal(service.status.sessions[0].peerId, session.peerId);
	assert.equal(service.pairing.metadata(first.roomId), undefined);

	assert.doesNotThrow(() =>
		service.reconnect.createChallenge({
			handle: grant.handle,
			origin: grant.sessionOrigin,
			clientNonce: 'client-nonce',
		}),
	);
	await service.revokeDevice('device-a');
	assert.equal(session.state, 'closed');
	assert.equal(service.reconnect.summary('device-a').status, 'revoked');
	assert.throws(
		() =>
			service.reconnect.createChallenge({
				handle: grant.handle,
				origin: grant.sessionOrigin,
				clientNonce: 'client-nonce-2',
			}),
		/no longer valid|unavailable/,
	);
	assert.equal(service.nodeDataChannelHost.snapshot.activeSessions, 0);

	await runtime.stop();
	assert.equal(service.nodeDataChannelHost.snapshot.state, 'closed');
});

test('server exposure admits through the injected selected runtime identity', async () => {
	FakePeer.instances.length = 0;
	const relay = signalingFixture();
	const service = createServerRemoteExposure({
		serverId: 'server-a',
		sessionOrigin: 'https://session.example.test',
		now: () => 100,
		cleanupIntervalMs: 0,
		nodeDataChannel: {
			runtime: 'werift',
			module: { PeerConnection: FakePeer },
			createSignaling: relay.createSignaling,
			role: 'answerer',
		},
	});
	assert.equal(service.nodeDataChannelHost.runtimeId, 'werift');
	const handoff = service.start(500);
	const pending = service.connectHeadless(
		{
			roomId: handoff.roomId,
			serverId: handoff.serverId,
			sessionOrigin: handoff.sessionOrigin,
			secret: handoff.secret,
		},
		proof(),
	);
	await new Promise((resolve) => setImmediate(resolve));
	relay.connections[0].inbound[0]({
		type: 'offer',
		sdp: 'offer-sdp',
		signature: 'valid',
	});
	const session = await pending;

	assert.equal(session.runtime, 'werift');
	assert.equal(service.nodeDataChannelHost.snapshot.runtime, 'werift');
	assert.equal(service.nodeDataChannelHost.snapshot.connectedSessions, 1);
	const cleanup = service.cleanup();
	assert.equal(cleanup.headlessRuntime, 'werift');
	assert.equal(cleanup.headlessRateLimitWindows, 0);
	assert.equal(
		cleanup.nodeDataChannelRateLimitWindows,
		cleanup.headlessRateLimitWindows,
	);
	await service.shutdown();
});

test('server-owned pairing admission is rate-limited and cleanup reclaims expired ledgers', () => {
	let now = 100;
	const service = createServerRemoteExposure({
		serverId: 'server-rate',
		sessionOrigin: 'https://rate.example.test',
		now: () => now,
		cleanupIntervalMs: 0,
		pairingRateLimit: { maxAttempts: 2, windowMs: 10 },
	});
	const room = service.start(500);
	const attempt = { ...room };
	assert.throws(
		() =>
			service.controller.consumePairing({ ...attempt, secret: 'wrong-one', rateLimitKey: 'caller-a' }),
		/invalid/,
	);
	assert.throws(
		() =>
			service.controller.consumePairing({ ...attempt, secret: 'wrong-two', rateLimitKey: 'caller-b' }),
		/invalid/,
	);
	assert.throws(
		() =>
			service.controller.consumePairing({ ...attempt, secret: 'wrong-three', rateLimitKey: 'caller-c' }),
		/rate limit/,
	);
	assert.equal(
		service.audit.list().some((event) => event.reason === 'rate-limited'),
		true,
	);

	now = 200;
	const report = service.cleanup();
	assert.equal(report.rateLimitWindows, 1);
	service.stopExposure();
	assert.equal(service.status.exposure.state, 'disabled');
	return service.shutdown();
});

test('unknown reconnect handles cannot exhaust the bounded server reconnect limiter', () => {
	const service = createServerRemoteExposure({
		serverId: 'server-reconnect-rate',
		sessionOrigin: 'https://reconnect-rate.example.test',
		cleanupIntervalMs: 0,
		reconnectRateLimit: { maxAttempts: 1, windowMs: 60_000, maxKeys: 1 },
	});
	const grant = service.issueReconnectGrant({
		deviceId: 'device-reconnect-rate',
		lifetime: 'until-revoked',
	});

	for (const suffix of ['a', 'b', 'c']) {
		assert.throws(
			() => service.createReconnectChallenge({
				handle: `${'x'.repeat(20)}${suffix}`,
				origin: grant.sessionOrigin,
				clientNonce: `nonce-${suffix}-abcdefgh`,
			}),
			/no longer valid|unavailable/,
		);
	}
	assert.equal(service.cleanup().reconnectRateLimitWindows, 0);

	assert.doesNotThrow(() =>
		service.createReconnectChallenge({
			handle: grant.handle,
			origin: grant.sessionOrigin,
			clientNonce: 'valid-nonce-abcdefgh',
		}),
	);
	assert.equal(service.cleanup().reconnectRateLimitWindows, 0);
	return service.shutdown();
});

test('successful reconnect proofs reset their grant retry window but challenge storms do not', () => {
	const service = createServerRemoteExposure({
		serverId: 'server-reconnect-window',
		sessionOrigin: 'https://reconnect-window.example.test',
		cleanupIntervalMs: 0,
		reconnectRateLimit: { maxAttempts: 2, windowMs: 60_000 },
	});
	const grant = service.issueReconnectGrant({
		deviceId: 'device-reconnect-window',
		lifetime: 'until-revoked',
	});
	const request = {
		handle: grant.handle,
		origin: grant.sessionOrigin,
		clientNonce: 'reconnect-window-nonce',
	};
	const first = service.createReconnectChallenge(request);
	service.createReconnectChallenge({ ...request, clientNonce: 'reconnect-window-nonce-2' });
	assert.throws(
		() => service.createReconnectChallenge({ ...request, clientNonce: 'reconnect-window-nonce-3' }),
		/rate limit/,
	);

	service.verifyReconnectProof({
		attemptId: first.challenge.attemptId,
		handle: grant.handle,
		origin: grant.sessionOrigin,
		clientNonce: request.clientNonce,
		proof: createRemoteReconnectProof(grant.grant, first.signingInput),
	});
	assert.doesNotThrow(() => service.createReconnectChallenge({
		...request,
		clientNonce: 'reconnect-window-nonce-4',
	}));
	return service.shutdown();
});

test('server-owned cleanup reclaims idle node-datachannel setup limiter windows', async () => {
	let now = 100;
	const service = createServerRemoteExposure({
		serverId: 'server-native-cleanup',
		sessionOrigin: 'https://native-cleanup.example.test',
		now: () => now,
		cleanupIntervalMs: 0,
		nodeDataChannel: {
			module: { PeerConnection: FakePeer },
			// Fail after host admission so this creates exactly one native setup
			// limiter ledger without creating a relay or native peer.
			createSignaling: () => null,
			connectionRateLimit: { maxAttempts: 1, windowMs: 10 },
		},
	});
	service.start(500);
	await assert.rejects(
		service.nodeDataChannelHost.connect({
			...proof('device-native-cleanup'),
			serverId: 'server-native-cleanup',
			sessionOrigin: 'https://native-cleanup.example.test',
		}),
		/node-datachannel signaling transport is invalid/,
	);

	now = 200;
	const report = service.cleanup();
	assert.equal(report.nodeDataChannelRateLimitWindows, 1);
	assert.equal(service.cleanup().nodeDataChannelRateLimitWindows, 0);
	await service.shutdown();
});

test('concurrent server-exposure shutdown callers wait for the same lifecycle drain', async () => {
	const service = createServerRemoteExposure({
		serverId: 'server-shutdown',
		sessionOrigin: 'https://shutdown.example.test',
		cleanupIntervalMs: 0,
	});
	let releaseControllerShutdown;
	service.controller.shutdown = () =>
		new Promise((resolve) => {
			releaseControllerShutdown = resolve;
		});

	const first = service.shutdown();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(typeof releaseControllerShutdown, 'function');

	let secondSettled = false;
	const second = service.shutdown().then(() => {
		secondSettled = true;
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(secondSettled, false, 'second shutdown must not return before cleanup');

	releaseControllerShutdown();
	await Promise.all([first, second]);
	assert.equal(secondSettled, true);
});
