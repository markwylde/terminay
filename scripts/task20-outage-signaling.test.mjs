import assert from 'node:assert/strict';
import test from 'node:test';
import { RemoteConnectionManager } from '@terminay/server-core';
import { NodeDataChannelHeadlessHost } from '../apps/terminay-server/dist/index.js';

const CHANNELS = ['control', 'application', 'terminal', 'assets'];

class FakeChannel {
	constructor(label) {
		this.label = label;
		this.closed = new Set();
		this.open = true;
	}

	getLabel() { return this.label; }
	isOpen() { return this.open; }
	bufferedAmount() { return 0; }
	sendMessageBinary() { return this.open; }
	onMessage() {}
	onClosed(listener) { this.closed.add(listener); }
	close() {
		if (!this.open) return;
		this.open = false;
		for (const listener of this.closed) listener();
	}
}

class FakePeer {
	static instances = [];

	constructor() {
		this.channels = new Map();
		FakePeer.instances.push(this);
	}

	onLocalDescription(listener) { this.localDescription = listener; }
	onLocalCandidate() {}
	onStateChange() {}
	onDataChannel(listener) { this.dataChannel = listener; }
	setRemoteDescription() {
		this.localDescription?.('answer-sdp', 'answer');
		for (const label of CHANNELS) {
			const channel = new FakeChannel(label);
			this.channels.set(label, channel);
			this.dataChannel?.(channel);
		}
	}
	addRemoteCandidate() {}
	close() { for (const channel of this.channels.values()) channel.close(); }
}

function proof(deviceId) {
	return {
		ticketId: `${deviceId}-ticket`,
		serverId: 'server-outage',
		sessionOrigin: 'https://session.example.test',
		deviceId,
		expiresAt: 10_000,
		authenticated: true,
	};
}

function manager() {
	const value = new RemoteConnectionManager({
		serverId: 'server-outage',
		sessionOrigin: 'https://session.example.test',
		now: () => 100,
	});
	value.expose(1_000);
	return value;
}

function healthySignaling() {
	const inbound = [];
	let closed = false;
	return {
		inbound,
		signaling: {
			send() {},
			onMessage(listener) {
				inbound.push(listener);
				return () => inbound.splice(inbound.indexOf(listener), 1);
			},
			sign: (message) => ({ ...message, signature: 'valid' }),
			verify: (message) => message?.signature === 'valid'
				? { type: message.type, ...(message.sdp === undefined
					? { candidate: message.candidate, mid: message.mid }
					: { sdp: message.sdp }) }
				: null,
			close: () => { closed = true; },
		},
		isClosed: () => closed,
	};
}

test('a transient authenticated signaling outage fails closed, leaves no peer, and permits a later fresh connection', async () => {
	FakePeer.instances.length = 0;
	const events = [];
	const healthy = healthySignaling();
	let signalingAttempts = 0;
	const host = new NodeDataChannelHeadlessHost({
		manager: manager(),
		module: { PeerConnection: FakePeer, cleanup() {} },
		createSignaling: () => {
			signalingAttempts += 1;
			if (signalingAttempts === 1) throw new Error('authenticated signaling relay unavailable');
			return healthy.signaling;
		},
		onEvent: (event) => events.push(event),
	});

	await assert.rejects(host.connect(proof('device-outage')), /signaling relay unavailable/);
	assert.deepEqual(
		{
			state: host.snapshot.state,
			activeSessions: host.snapshot.activeSessions,
			pendingConnections: host.snapshot.pendingConnections,
			connectAttempts: host.snapshot.connectAttempts,
			connectedSessions: host.snapshot.connectedSessions,
			failedConnections: host.snapshot.failedConnections,
		},
		{
			state: 'ready', activeSessions: 0, pendingConnections: 0,
			connectAttempts: 1, connectedSessions: 0, failedConnections: 1,
		},
	);
	assert.equal(FakePeer.instances.length, 0, 'an unavailable relay must not allocate a native peer');
	assert.deepEqual(events.map((event) => event.type), ['connect-started', 'connect-failed']);

	const pending = host.connect(proof('device-recovered'));
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(healthy.inbound.length, 1, 'the recovered attempt gets one fresh authenticated subscription');
	healthy.inbound[0]({ type: 'offer', sdp: 'offer-sdp', signature: 'valid' });
	const session = await pending;
	assert.equal(session.snapshot().state, 'connected');
	assert.equal(host.snapshot.activeSessions, 1);

	await host.closePeer(session.peerId);
	assert.equal(healthy.isClosed(), true, 'normal cleanup closes the recovered relay subscription');
	assert.equal(host.snapshot.activeSessions, 0);
	await host.shutdown();
});
