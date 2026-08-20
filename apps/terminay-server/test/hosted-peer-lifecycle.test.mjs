import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import {
	createHandshakeJoinQueue,
	DEFAULT_HOSTED_ICE_SERVERS,
	hostedPeerConfiguration,
	HostedPeerLifecycle,
	parseHostedIceServers,
	resolveHostedIceServers,
} from '../src/remote/hostedPeerLifecycle.ts';

test('empty ICE server config uses the default STUN server', () => {
	assert.deepEqual(parseHostedIceServers(''), DEFAULT_HOSTED_ICE_SERVERS);
	assert.deepEqual(resolveHostedIceServers([]), DEFAULT_HOSTED_ICE_SERVERS);
	assert.deepEqual(resolveHostedIceServers(undefined), DEFAULT_HOSTED_ICE_SERVERS);
	assert.deepEqual(hostedPeerConfiguration('example.terminay.com').iceServers, [
		...DEFAULT_HOSTED_ICE_SERVERS,
	]);
});

test('host peer configuration uses the advertised ICE servers', () => {
	const iceServers = [{ urls: 'turn:turn.example.test:3478', username: 'u', credential: 'p' }];
	assert.deepEqual(hostedPeerConfiguration('example.terminay.com', iceServers).iceServers, iceServers);
	assert.deepEqual(
		parseHostedIceServers('stun:stun.example.test:3478,stun:stun.example.test:3479'),
		[{ urls: 'stun:stun.example.test:3478' }, { urls: 'stun:stun.example.test:3479' }],
	);
});

test('ICE disconnected while the peer stays connected does not close the session', () => {
	mock.timers.enable({ apis: ['setTimeout'] });
	try {
		const peer = { connectionState: 'connected', iceConnectionState: 'connected' };
		const reasons = [];
		const lifecycle = new HostedPeerLifecycle(peer, 5_000, (reason) => reasons.push(reason));
		peer.iceConnectionState = 'disconnected';
		lifecycle.observe('ice');
		mock.timers.tick(5_000);
		assert.deepEqual(reasons, []);
		lifecycle.observe('ice');
		assert.deepEqual(reasons, []);
	} finally {
		mock.timers.reset();
	}
});

test('ICE disconnected while the peer is also disconnected closes once after grace', () => {
	mock.timers.enable({ apis: ['setTimeout'] });
	try {
		const peer = { connectionState: 'disconnected', iceConnectionState: 'disconnected' };
		const reasons = [];
		const lifecycle = new HostedPeerLifecycle(peer, 5_000, (reason) => reasons.push(reason));
		lifecycle.observe('ice');
		assert.deepEqual(reasons, []);
		mock.timers.tick(4_999);
		assert.deepEqual(reasons, []);
		mock.timers.tick(1);
		assert.equal(reasons.length, 1);
		assert.match(reasons[0], /grace period expired/u);
		lifecycle.observe('ice');
		assert.equal(reasons.length, 1);
	} finally {
		mock.timers.reset();
	}
});

test('ICE disconnected recovers inside grace without closing the session', () => {
	mock.timers.enable({ apis: ['setTimeout'] });
	try {
		const peer = { connectionState: 'connected', iceConnectionState: 'connected' };
		const reasons = [];
		const lifecycle = new HostedPeerLifecycle(peer, 5_000, (reason) => reasons.push(reason));
		peer.iceConnectionState = 'disconnected';
		lifecycle.observe('ice');
		peer.iceConnectionState = 'connected';
		lifecycle.observe('ice');
		mock.timers.tick(5_000);
		assert.deepEqual(reasons, []);
	} finally {
		mock.timers.reset();
	}
});

test('ICE failed closes the session immediately', () => {
	const peer = { connectionState: 'connected', iceConnectionState: 'failed' };
	const reasons = [];
	const lifecycle = new HostedPeerLifecycle(peer, 5_000, (reason) => reasons.push(reason));
	lifecycle.observe('ice');
	assert.equal(reasons.length, 1);
	assert.match(reasons[0], /ICE connection failed/u);
	lifecycle.observe('peer');
	assert.equal(reasons.length, 1);
});

test('retiring a handshake stops grace from closing another session', () => {
	mock.timers.enable({ apis: ['setTimeout'] });
	try {
		const peer = { connectionState: 'connected', iceConnectionState: 'disconnected' };
		const reasons = [];
		const lifecycle = new HostedPeerLifecycle(peer, 5_000, (reason) => reasons.push(reason));
		lifecycle.observe('ice');
		lifecycle.stop();
		mock.timers.tick(5_000);
		assert.deepEqual(reasons, []);
	} finally {
		mock.timers.reset();
	}
});

test('handshake joins run one at a time', async () => {
	const queue = createHandshakeJoinQueue();
	const order = [];
	let releaseFirst;
	const first = queue.enqueue(
		() =>
			new Promise((resolve) => {
				order.push('first-start');
				releaseFirst = resolve;
			}),
	);
	const second = queue.enqueue(async () => {
		order.push('second-start');
	});
	await Promise.resolve();
	assert.deepEqual(order, ['first-start']);
	releaseFirst();
	await Promise.all([first, second]);
	assert.deepEqual(order, ['first-start', 'second-start']);
});
