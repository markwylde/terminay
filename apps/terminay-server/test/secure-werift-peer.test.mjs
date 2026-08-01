import assert from 'node:assert/strict';
import test from 'node:test';
import { RemoteConnectionManager } from '@terminay/server-core';
import { createSecureWeriftHeadlessHost } from '../dist/remote/secureWeriftHost.js';
import { createSecureWeriftCompatibilityModule } from '../dist/remote/secureWeriftPeer.js';

class FakeWeriftChannel {
	constructor(label) {
		this.label = label;
		this.readyState = 'open';
		this.bufferedAmount = 0;
		this.listeners = new Map();
		this.sent = [];
	}
	addEventListener(type, listener) {
		this.listeners.set(type, listener);
	}
	send(frame) {
		this.sent.push(new Uint8Array(frame));
	}
	close() {
		this.readyState = 'closed';
		this.listeners.get('close')?.({});
	}
}

class FakeWeriftPeer {
	static instances = [];
	constructor(configuration) {
		this.configuration = configuration;
		this.listeners = new Map();
		this.connectionState = 'new';
		FakeWeriftPeer.instances.push(this);
	}
	addEventListener(type, listener) {
		this.listeners.set(type, listener);
	}
	createDataChannel(label) {
		this.channel = new FakeWeriftChannel(label);
		return this.channel;
	}
	async createOffer() {
		return { type: 'offer', sdp: 'werift-offer' };
	}
	async createAnswer() {
		return { type: 'answer', sdp: 'werift-answer' };
	}
	async setLocalDescription(description) {
		this.localDescription = description;
	}
	async setRemoteDescription(description) {
		this.remoteDescription = description;
	}
	async addIceCandidate(candidate) {
		this.remoteCandidate = candidate;
	}
	close() {
		this.connectionState = 'closed';
	}
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('selected Werift peer publishes offers and normalized ICE through the hardened peer shape', async () => {
	const module = createSecureWeriftCompatibilityModule({
		RTCPeerConnection: FakeWeriftPeer,
	});
	const Peer = module.PeerConnection;
	const peer = new Peer('peer-a', {
		iceServers: [{ urls: 'stun:example.test' }],
	});
	const descriptions = [];
	const candidates = [];
	peer.onLocalDescription((sdp, type) => descriptions.push({ sdp, type }));
	peer.onLocalCandidate((candidate, mid) =>
		candidates.push({ candidate, mid }),
	);
	const channel = peer.createDataChannel('application', { ordered: true });
	await tick();
	assert.deepEqual(descriptions, [{ sdp: 'werift-offer', type: 'offer' }]);
	assert.equal(
		FakeWeriftPeer.instances.at(-1).configuration.maxMessageSize,
		1024 * 1024,
	);
	assert.equal(channel.getLabel(), 'application');

	FakeWeriftPeer.instances.at(-1).listeners.get('icecandidate')({
		candidate: {
			toJSON: () => ({
				candidate: 'candidate-a',
				sdpMid: '0',
				optional: undefined,
			}),
		},
	});
	assert.deepEqual(candidates, [{ candidate: 'candidate-a', mid: '0' }]);
});

test('selected Werift answerer and binary channel preserve exact response identity', async () => {
	const module = createSecureWeriftCompatibilityModule({
		RTCPeerConnection: FakeWeriftPeer,
	});
	const Peer = module.PeerConnection;
	const peer = new Peer('peer-b');
	const descriptions = [];
	const channels = [];
	peer.onLocalDescription((sdp, type) => descriptions.push({ sdp, type }));
	peer.onDataChannel((channel) => channels.push(channel));
	peer.setRemoteDescription('browser-offer', 'offer');
	await tick();
	assert.deepEqual(descriptions, [{ sdp: 'werift-answer', type: 'answer' }]);

	const native = new FakeWeriftChannel('assets');
	FakeWeriftPeer.instances.at(-1).listeners.get('datachannel')({
		channel: native,
	});
	const frames = [];
	channels[0].onMessage((frame) => frames.push(frame));
	native.listeners.get('message')({ data: Uint8Array.of(1, 2, 3).buffer });
	assert.deepEqual([...frames[0]], [1, 2, 3]);
});

test('production host admits only the formally selected Werift runtime identity', async () => {
	const manager = new RemoteConnectionManager({
		serverId: 'server-a',
		sessionOrigin: 'https://session.example.test',
		now: () => 100,
	});
	manager.expose(1_000);
	const host = createSecureWeriftHeadlessHost({
		runtimeRoot: '/selected/runtime',
		manager,
		createSignaling: () => {
			throw new Error('must not allocate signaling for a foreign runtime');
		},
	});
	await assert.rejects(
		host.connect('node-datachannel', {
			ticketId: 'foreign-ticket',
			serverId: 'server-a',
			sessionOrigin: 'https://session.example.test',
			deviceId: 'device-a',
			expiresAt: 900,
			authenticated: true,
		}),
		/runtime node-datachannel is unavailable/u,
	);
	assert.equal(host.snapshot.connectAttempts, 0);
	await host.shutdown();
});
