import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	DEVICE_HOST_AVAILABILITY_MS,
	DEVICE_REFRESH_LEAD_MS,
	deviceHostRefreshDelayMs,
	HostedLivePeerRegistry,
	REQUIRED_LANES,
	requiredLaneClosed,
} from '../src/remote/hostedPeerLifecycle.ts';

test('one device holds one live peer, and a rejoin retires the peer it replaces', async () => {
	const order = [];
	const registry = new HostedLivePeerRegistry();
	const first = {
		peer: { close: () => order.push('peer:first') },
		connection: { close: () => order.push('connection:first') },
	};
	registry.set('device-a', first);
	registry.set('device-b', {
		peer: { close: () => order.push('peer:b') },
		connection: { close: () => order.push('connection:b') },
	});
	assert.equal(registry.size, 2);

	const replaced = await registry.close('device-a');
	assert.equal(replaced, first);
	assert.equal(registry.size, 1, 'the replaced device holds no live peer');
	// The server connection is released before the peer, because its cleanup is
	// what frees that device's attachments and leases.
	assert.deepEqual(order, ['connection:first', 'peer:first']);

	const second = {
		peer: { close: () => order.push('peer:second') },
		connection: { close: () => order.push('connection:second') },
	};
	registry.set('device-a', second);
	assert.equal(registry.get('device-a'), second);
	assert.equal(registry.size, 2);
});

test('a superseded generation cannot evict the peer that replaced it', () => {
	const registry = new HostedLivePeerRegistry();
	const superseded = { peer: { close: () => undefined } };
	const replacement = { peer: { close: () => undefined } };
	registry.set('device-a', superseded);
	registry.set('device-a', replacement);

	// The superseded peer's teardown arrives late, as it does in production when
	// its transport finally gives up. It must not remove the live replacement.
	assert.equal(registry.drop('device-a', superseded.peer), undefined);
	assert.equal(registry.get('device-a'), replacement);
	assert.equal(registry.drop('device-a', replacement.peer), replacement);
	assert.equal(registry.size, 0);
});

test('closing the host releases every live peer exactly once', async () => {
	const closed = [];
	const registry = new HostedLivePeerRegistry();
	for (const deviceId of ['device-a', 'device-b', 'device-c']) {
		registry.set(deviceId, {
			peer: { close: () => closed.push(deviceId) },
			connection: { close: () => undefined },
		});
	}
	await registry.closeAll();
	assert.deepEqual(closed, ['device-a', 'device-b', 'device-c']);
	assert.equal(registry.size, 0);
	await registry.closeAll();
	assert.equal(closed.length, 3, 'a second close is a no-op');
});

test('a required lane hangs up only after it has actually opened', () => {
	assert.deepEqual(
		[...REQUIRED_LANES].sort(),
		['application', 'assets', 'control', 'terminal'],
	);
	// Handshake ordering is not a delivery failure: a lane still negotiating
	// must never tear down the generation that is being established.
	assert.equal(requiredLaneClosed('control', 'connecting', false), false);
	assert.equal(requiredLaneClosed('control', 'closed', false), false);
	// A lane that carried traffic and then left `open` cannot deliver again.
	assert.equal(requiredLaneClosed('control', 'closed', true), true);
	assert.equal(requiredLaneClosed('application', 'closing', true), true);
	assert.equal(requiredLaneClosed('terminal', 'failed', true), true);
	assert.equal(requiredLaneClosed('assets', 'closed', true), true);
	assert.equal(requiredLaneClosed('control', 'open', true), false);
	// Bootstrap lanes deliver the host context and the UI archive, then close.
	assert.equal(requiredLaneClosed('api', 'closed', true), false);
	assert.equal(requiredLaneClosed('asset', 'closed', true), false);
	assert.equal(requiredLaneClosed(undefined, 'closed', true), false);
});

test('device host signaling refreshes 20 minutes after register, not by closing live peers', () => {
	const now = 1_000_000;
	assert.equal(DEVICE_HOST_AVAILABILITY_MS, 25 * 60 * 1000);
	assert.equal(DEVICE_REFRESH_LEAD_MS, 5 * 60 * 1000);
	assert.equal(
		deviceHostRefreshDelayMs(now + DEVICE_HOST_AVAILABILITY_MS, now),
		20 * 60 * 1000,
	);
});

test('the production hosted pairing host owns ICE servers, grace, and one handshake', async () => {
	const [host, lifecycle, exposure, main, cli] = await Promise.all([
		readFile(new URL('../src/remote/hostedPairingHost.ts', import.meta.url), 'utf8'),
		readFile(new URL('../src/remote/hostedPeerLifecycle.ts', import.meta.url), 'utf8'),
		readFile(
			new URL('../../../electron/remote/serverOwnedExposure.ts', import.meta.url),
			'utf8',
		),
		readFile(new URL('../../../electron/main.ts', import.meta.url), 'utf8'),
		readFile(new URL('../src/cli.ts', import.meta.url), 'utf8'),
	]);
	assert.match(lifecycle, /iceConnectionState/u);
	assert.match(lifecycle, /needsDisconnectGrace/u);
	assert.match(lifecycle, /DEFAULT_HOSTED_ICE_SERVERS/u);
	assert.match(lifecycle, /iceServers: \[\.\.\.resolveHostedIceServers/u);
	assert.doesNotMatch(host, /iceServers: \[\]/u);
	assert.match(host, /createHandshakeJoinQueue/u);
	assert.match(host, /new HostedPeerLifecycle/u);
	assert.match(host, /collectHostIceAddresses\(networkInterfaces\(\)\)/u);
	assert.match(host, /HostedLivePeerRegistry/u);
	// A device join retires the peer it replaces before creating its successor.
	assert.match(host, /await livePeers\.close\(scope\.deviceId\)/u);
	assert.match(host, /deviceHostRefreshDelayMs/u);
	assert.match(host, /iceconnectionstatechange/u);
	assert.match(host, /handshakeGeneration/u);
	assert.match(host, /applyHandshakeSignal/u);
	// Liveness is explicit. No traffic-pattern inference survives in the host.
	assert.doesNotMatch(host, /stallClass|shouldFailHostedStall|laneCloseHangsUp/u);
	assert.doesNotMatch(lifecycle, /stallClass|shouldFailHostedStall|laneCloseHangsUp/u);
	assert.match(exposure, /resolveIceServers/u);
	assert.match(
		main,
		/parseHostedIceServers\(\s*readEmbeddedRemoteAccessSettings\(\)\.webRtcIceServers,?\s*\)/u,
	);
	assert.match(cli, /TERMINAY_WEBRTC_ICE_SERVERS/u);
	assert.match(cli, /parseHostedIceServers/u);
});

test('a replaced peer is reported as disconnected without waiting for a native close event', async () => {
	const registry = new HostedLivePeerRegistry();
	const disconnected = []
	// A native datachannel is not guaranteed to emit `close` before its peer is
	// torn down. The replacement path must not depend on that event, or a
	// superseded connection stays listed as live for the rest of the session.
	registry.set('device-a', {
		peer: { close: () => undefined },
		connection: { close: () => undefined },
		connectionId: 'connection-superseded',
	});
	const replaced = await registry.close('device-a');
	if (replaced?.connectionId !== undefined) disconnected.push(replaced.connectionId);
	assert.deepEqual(disconnected, ['connection-superseded']);
});
