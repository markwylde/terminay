import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mock, test } from 'node:test';
import {
	collectHostIceAddresses,
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

test('host ICE addresses include LAN and VPN overlays and omit link-local', () => {
	assert.deepEqual(
		collectHostIceAddresses({
			lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
			en0: [{ address: '192.168.1.20', family: 'IPv4', internal: false }],
			utun4: [{ address: '100.101.102.103', family: 'IPv4', internal: false }],
			awdl0: [{ address: 'fe80::1', family: 'IPv6', internal: false }],
			en1: [{ address: '169.254.1.1', family: 'IPv4', internal: false }],
			utun5: [{ address: 'fd7a:115c:a1e0::1', family: 'IPv6', internal: false }],
		}),
		['127.0.0.1', '192.168.1.20', '100.101.102.103', 'fd7a:115c:a1e0::1'],
	);
});

test('non-loopback host peer configuration advertises every usable local address', () => {
	const config = hostedPeerConfiguration('example.terminay.com', undefined, [
		'192.168.1.20',
		'100.101.102.103',
		'169.254.1.1',
	]);
	assert.deepEqual(config.iceAdditionalHostAddresses, [
		'192.168.1.20',
		'100.101.102.103',
	]);
	assert.equal(config.iceUseIpv4, true);
	assert.equal(config.iceUseIpv6, true);
	assert.equal('iceInterfaceAddresses' in config, false);
});

test('loopback signaling still pins ICE to 127.0.0.1', () => {
	const config = hostedPeerConfiguration('127.0.0.1', undefined, [
		'192.168.1.20',
		'100.101.102.103',
	]);
	assert.deepEqual(config.iceAdditionalHostAddresses, ['127.0.0.1']);
	assert.deepEqual(config.iceInterfaceAddresses, { udp4: '127.0.0.1' });
});

test('a server that dials its own relay over loopback still offers reachable candidates', async () => {
	// A direct endpoint reaches its own signaling over 127.0.0.1, but the media
	// path it advertises is the one a remote client has to use. Narrowing ICE to
	// loopback there would publish candidates nothing off the box can reach.
	const source = await readFile(new URL('../src/cli.ts', import.meta.url), 'utf8');
	const directHost = source.slice(source.indexOf("await startPairingHost(\n\t\t\t\t\t\t\t'direct'"));
	assert.match(directHost, /connectHost: '127\.0\.0\.1'/u);
	assert.match(directHost, /signalingOnlyConnectHost: true/u);

	const host = await readFile(new URL('../src/remote/hostedPairingHost.ts', import.meta.url), 'utf8');
	assert.match(
		host,
		/signalingOnlyConnectHost === true\s*\?\s*undefined\s*:\s*context\.options\.signal\?\.connectHost/u,
		'the signaling-only connect host must not reach the peer configuration',
	);

	// Without the connect host, gathering stays on the real interfaces.
	const config = hostedPeerConfiguration(undefined, undefined, ['192.168.1.20']);
	assert.equal(config.iceUseIpv4, true);
	assert.equal(config.iceUseIpv6, true);
	assert.equal('iceInterfaceAddresses' in config, false);
	assert.deepEqual(config.iceAdditionalHostAddresses, ['192.168.1.20']);
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

test('ICE disconnected while the peer stays connected does not start grace', () => {
	const phases = [];
	const peer = { connectionState: 'connected', iceConnectionState: 'disconnected' };
	const lifecycle = new HostedPeerLifecycle(peer, 5_000, () => {}, {
		onGrace(phase) {
			phases.push(phase);
		},
	});
	lifecycle.observe('ice');
	assert.deepEqual(phases, []);
	lifecycle.stop();
});

test('peer and ICE disconnected starts grace', () => {
	mock.timers.enable({ apis: ['setTimeout'] });
	try {
		const phases = [];
		const peer = { connectionState: 'disconnected', iceConnectionState: 'disconnected' };
		const lifecycle = new HostedPeerLifecycle(peer, 5_000, () => {}, {
			onGrace(phase) {
				phases.push(phase);
			},
		});
		lifecycle.observe('ice');
		assert.deepEqual(phases, ['started']);
		peer.connectionState = 'connected';
		peer.iceConnectionState = 'connected';
		lifecycle.observe('peer');
		assert.deepEqual(phases, ['started', 'cleared']);
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

test('an advertised address is added to the gathered candidates, never in place of them', () => {
	const gathered = ['192.168.1.20', '100.101.102.103'];
	const without = hostedPeerConfiguration('example.terminay.com', undefined, gathered);
	const with_ = hostedPeerConfiguration('example.terminay.com', undefined, gathered, {
		host: '127.0.0.1',
		port: 51000,
	});

	// Every address the server would have offered is still offered.
	for (const address of without.iceAdditionalHostAddresses) {
		assert.ok(
			with_.iceAdditionalHostAddresses.includes(address),
			`enabling the advertised address dropped ${address}`,
		);
	}
	assert.ok(with_.iceAdditionalHostAddresses.includes('127.0.0.1'));
	assert.equal(with_.iceUseIpv4, true);
	assert.equal(with_.iceUseIpv6, true);
});

test('an advertised address pins the ICE socket to its port', () => {
	const config = hostedPeerConfiguration('example.terminay.com', undefined, [], {
		host: '203.0.113.7',
		port: 51000,
	});
	// A candidate is only forwardable if its port is known in advance, so the
	// socket must bind the advertised port rather than an ephemeral one.
	assert.deepEqual([...config.icePortRange], [51000, 51000]);
});

test('no advertised address leaves the socket and candidates untouched', () => {
	const config = hostedPeerConfiguration('example.terminay.com', undefined, ['192.168.1.20']);
	assert.equal(config.icePortRange, undefined);
	assert.deepEqual(config.iceAdditionalHostAddresses, ['192.168.1.20']);
});

test('an advertised address survives the loopback-signaling branch', () => {
	// A server that signals over loopback still has to offer a media path a
	// remote client can use; the advertised address is exactly that path.
	const config = hostedPeerConfiguration('127.0.0.1', undefined, [], {
		host: '198.51.100.9',
		port: 51000,
	});
	assert.ok(config.iceAdditionalHostAddresses.includes('198.51.100.9'));
	assert.deepEqual([...config.icePortRange], [51000, 51000]);
});

test('an advertised address is offered even when it is not a gatherable local address', () => {
	// The point of the option is naming an address the server cannot observe
	// about itself, so it must not be filtered the way gathered addresses are.
	const config = hostedPeerConfiguration('example.terminay.com', undefined, ['169.254.1.1'], {
		host: '169.254.9.9',
		port: 51000,
	});
	assert.ok(config.iceAdditionalHostAddresses.includes('169.254.9.9'));
	assert.ok(!config.iceAdditionalHostAddresses.includes('169.254.1.1'), 'gathered link-local is still dropped');
});
