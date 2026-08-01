import assert from 'node:assert/strict';
import test from 'node:test';
import {
	RemoteConnectionManager,
	RemoteHeadlessWebRtcFactory,
} from '../dist/remote/index.js';

class FakeChannel {
	constructor(label, bufferedAmount = 0) {
		this.label = label;
		this.readyState = 'open';
		this.bufferedAmount = bufferedAmount;
		this.sent = [];
		this.messages = new Set();
		this.states = new Set();
	}

	send(frame) {
		if (this.readyState !== 'open') throw new Error('channel is not open');
		this.sent.push(new Uint8Array(frame));
	}

	close() {
		if (this.readyState === 'closed') return;
		this.readyState = 'closed';
		for (const listener of [...this.states]) listener('closed');
	}

	onMessage(listener) {
		this.messages.add(listener);
		return () => this.messages.delete(listener);
	}
	onStateChange(listener) {
		this.states.add(listener);
		return () => this.states.delete(listener);
	}
	emit(frame) {
		for (const listener of [...this.messages]) listener(frame);
	}
}

class CloseDuringStateRegistrationChannel extends FakeChannel {
	onStateChange(listener) {
		const remove = super.onStateChange(listener);
		this.readyState = 'closed';
		listener('closed');
		return remove;
	}
}

function fixture({ maxFrameBytes = 4, maxBufferedBytes = 8 } = {}) {
	let now = 100;
	const manager = new RemoteConnectionManager({
		serverId: 'srv',
		sessionOrigin: 'https://session.example.test',
		now: () => now,
		maxFrameBytes,
		maxQueuedBytes: 8,
	});
	manager.expose(1000);
	const channels = new Map(
		['control', 'application', 'terminal', 'assets'].map((name) => [
			name,
			new FakeChannel(name),
		]),
	);
	let connects = 0;
	const factory = new RemoteHeadlessWebRtcFactory({
		manager,
		maxFrameBytes,
		maxBufferedBytes,
		runtimes: [
			{
				runtime: 'custom',
				async connect(context) {
					connects += 1;
					assert.equal(context.serverId, 'srv');
					assert.equal(context.sessionOrigin, 'https://session.example.test');
					assert.deepEqual(context.channels, [
						'control',
						'application',
						'terminal',
						'assets',
					]);
					return channels;
				},
			},
		],
	});
	const proof = {
		ticketId: 'ticket-1',
		serverId: 'srv',
		sessionOrigin: 'https://session.example.test',
		deviceId: 'device-1',
		expiresAt: 900,
		authenticated: true,
	};
	return {
		manager,
		channels,
		factory,
		proof,
		get connects() {
			return connects;
		},
		advance(value) {
			now = value;
		},
	};
}

test('headless runtime selection admits exact channels and bridges bounded frames', async () => {
	const fixtureValue = fixture();
	const session = await fixtureValue.factory.connect(
		'custom',
		fixtureValue.proof,
	);
	assert.equal(fixtureValue.connects, 1);
	fixtureValue.channels.get('terminal').emit(new Uint8Array([1, 2]));
	assert.deepEqual([...session.drain('terminal')[0]], [1, 2]);
	session.send('control', new Uint8Array([3, 4]));
	assert.deepEqual([...fixtureValue.channels.get('control').sent[0]], [3, 4]);
	assert.throws(
		() => session.send('assets', new Uint8Array([1, 2, 3, 4, 5])),
		/frame size/,
	);
});

test('headless adapter enforces channel backpressure and closes on invalid inbound frames', async () => {
	const fixtureValue = fixture({ maxFrameBytes: 4, maxBufferedBytes: 4 });
	fixtureValue.channels.get('control').bufferedAmount = 4;
	const session = await fixtureValue.factory.connect(
		'custom',
		fixtureValue.proof,
	);
	assert.throws(
		() => session.send('control', new Uint8Array([1])),
		/backpressure/,
	);
	fixtureValue.channels.get('terminal').emit(new Uint8Array([1, 2, 3, 4, 5]));
	await Promise.resolve();
	assert.equal(session.state, 'closed');
	assert.equal(fixtureValue.manager.snapshot().peers.length, 0);
});

test('headless factory rejects unavailable runtimes, cross-origin proofs, and malformed channel sets', async () => {
	const fixtureValue = fixture();
	await assert.rejects(
		() => fixtureValue.factory.connect('werift', fixtureValue.proof),
		/unavailable/,
	);
	await assert.rejects(
		() =>
			fixtureValue.factory.connect('custom', {
				...fixtureValue.proof,
				ticketId: 'ticket-2',
				sessionOrigin: 'https://other.example.test',
			}),
		/identity mismatch/,
	);

	const malformedManager = new RemoteConnectionManager({
		serverId: 'srv',
		sessionOrigin: 'https://session.example.test',
	});
	malformedManager.expose(Date.now() + 1000);
	const malformed = new RemoteHeadlessWebRtcFactory({
		manager: malformedManager,
		runtimes: [
			{
				runtime: 'custom',
				async connect() {
					return new Map();
				},
			},
		],
	});
	await assert.rejects(
		() =>
			malformed.connect('custom', {
				...fixtureValue.proof,
				ticketId: 'ticket-3',
				expiresAt: Date.now() + 1000,
			}),
		/channel set/,
	);
	assert.equal(malformedManager.snapshot().peers.length, 0);
});

test('a channel closed while session lifecycle listeners register is never published', async () => {
	const fixtureValue = fixture();
	const terminal = new CloseDuringStateRegistrationChannel('terminal');
	fixtureValue.channels.set('terminal', terminal);

	await assert.rejects(
		fixtureValue.factory.connect('custom', fixtureValue.proof),
		/session listener registration/,
	);
	assert.equal(fixtureValue.manager.snapshot().peers.length, 0);
	assert.equal(fixtureValue.factory.snapshot().length, 0);
	assert.equal(terminal.readyState, 'closed');
	for (const channel of fixtureValue.channels.values()) {
		assert.equal(channel.readyState, 'closed');
	}
});

test('closing one headless session tears down all channels and the admitted peer', async () => {
	const fixtureValue = fixture();
	const session = await fixtureValue.factory.connect(
		'custom',
		fixtureValue.proof,
	);
	await session.close();
	assert.equal(session.state, 'closed');
	assert.equal(fixtureValue.channels.get('control').readyState, 'closed');
	assert.equal(fixtureValue.manager.snapshot().peers.length, 0);
	await fixtureValue.factory.closeAll();
});

test('device revocation fences an admitted headless session before another send', async () => {
	const fixtureValue = fixture();
	const session = await fixtureValue.factory.connect(
		'custom',
		fixtureValue.proof,
	);
	assert.equal(await fixtureValue.factory.revokeDevice('device-1'), 1);
	assert.throws(() => session.send('control', new Uint8Array([1])), /closed/);
	assert.equal(session.state, 'closed');
	assert.equal(fixtureValue.channels.get('control').readyState, 'closed');
});

test('device revocation aborts an in-flight headless negotiation before it can publish a session', async () => {
	const fixtureValue = fixture();
	let resolveConnect;
	const pendingChannels = new Promise((resolve) => {
		resolveConnect = resolve;
	});
	const factory = new RemoteHeadlessWebRtcFactory({
		manager: fixtureValue.manager,
		runtimes: [{ runtime: 'custom', connect: async () => pendingChannels }],
	});

	const pending = factory.connect('custom', fixtureValue.proof);
	await Promise.resolve();
	assert.equal(await factory.revokeDevice('device-1'), 1);
	assert.deepEqual(
		fixtureValue.manager.snapshot().peers,
		[],
		'revocation immediately releases an admitted negotiation even if its runtime never observes abort',
	);
	resolveConnect(fixtureValue.channels);

	await assert.rejects(pending, /aborted/);
	assert.equal(factory.snapshot().length, 0);
	assert.equal(fixtureValue.manager.snapshot().peers.length, 0);
	for (const channel of fixtureValue.channels.values()) {
		assert.equal(channel.readyState, 'closed');
	}
});

test('caller cancellation releases an admitted headless negotiation and closes late channels', async () => {
	const fixtureValue = fixture();
	let resolveConnect;
	const pendingChannels = new Promise((resolve) => {
		resolveConnect = resolve;
	});
	const factory = new RemoteHeadlessWebRtcFactory({
		manager: fixtureValue.manager,
		runtimes: [{ runtime: 'custom', connect: async () => pendingChannels }],
	});
	const controller = new AbortController();
	const pending = factory.connect('custom', fixtureValue.proof, controller.signal);
	await Promise.resolve();

	controller.abort();
	resolveConnect(fixtureValue.channels);

	await assert.rejects(pending, /aborted/);
	assert.equal(factory.snapshot().length, 0);
	assert.equal(fixtureValue.manager.snapshot().peers.length, 0);
	for (const channel of fixtureValue.channels.values()) {
		assert.equal(channel.readyState, 'closed');
	}
});
