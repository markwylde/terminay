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
	MAX_LIVE_WINDOWS_PER_DEVICE,
	readWindowId,
} from '../src/remote/hostedPeerLifecycle.ts';
import { createPairingOperationQueue } from '../src/remote/pairingOperationQueue.ts';

test('shared pairing rotation operations run one at a time across exposure modes', async () => {
	const queue = createPairingOperationQueue();
	const order = [];
	let releaseFirst;
	const first = queue.run(async () => {
		order.push('approval-start');
		await new Promise((resolve) => {
			releaseFirst = resolve;
		});
		order.push('approval-finish');
	});
	const second = queue.run(async () => {
		order.push('qr-rotation');
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(order, ['approval-start']);
	releaseFirst();
	await Promise.all([first, second]);
	assert.deepEqual(order, ['approval-start', 'approval-finish', 'qr-rotation']);
});

test('standalone exposure hosts serialize the full refresh through relay registration', async () => {
	const cli = await readFile(
		new URL('../src/cli.ts', import.meta.url),
		'utf8',
	);
	const host = await readFile(
		new URL('../src/remote/hostedPairingHost.ts', import.meta.url),
		'utf8',
	);
	assert.match(cli, /serializePairingRefresh: \(operation\) =>\s*pairingRoomOperations\.run\(operation\)/u);
	assert.match(host, /options\.serializePairingRefresh\(\(\) => refreshPairingNow\(cause\)\)/u);
	assert.match(host, /await registerPairing\(currentHandoff\)/u);
});

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
	assert.deepEqual([...REQUIRED_LANES].sort(), [
		'application',
		'assets',
		'control',
		'terminal',
	]);
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
		readFile(
			new URL('../src/remote/hostedPairingHost.ts', import.meta.url),
			'utf8',
		),
		readFile(
			new URL('../src/remote/hostedPeerLifecycle.ts', import.meta.url),
			'utf8',
		),
		readFile(
			new URL(
				'../../../electron/remote/serverOwnedExposure.ts',
				import.meta.url,
			),
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
	// A device's live peer is replaced only after the joiner consumed a ticket:
	// an unauthenticated device-join never touches it.
	assert.doesNotMatch(host, /await livePeers\.close\(scope\.deviceId\)/u);
	// The replacement closes this window's previous peer and no other.
	assert.match(
		host,
		/const replaced = await context\.livePeers\.close\(\s*authenticated\.deviceId,\s*windowId,\s*\)/u,
	);
	// Which window it is comes from the authenticated lane, never signaling.
	assert.match(host, /const windowId = readWindowId\(request\.windowId\)/u);
	assert.doesNotMatch(host, /message\.windowId|scope\.windowId/u);
	assert.match(host, /options\.remote\.onDeviceRevoked\?\.\(/u);
	// That takeover is ordered per device. Sharing the handshake join queue put
	// the application-auth reply behind unrelated addIceCandidate work.
	assert.match(
		host,
		/context\s*\.replaceDevicePeer\(\s*authenticated\.deviceId/u,
	);
	assert.doesNotMatch(host, /serialize: joinQueue\.enqueue/u);
	assert.match(
		host,
		/verifyDeviceJoinProof\(deviceId, clientNonce, message\.deviceProof\)/u,
	);
	assert.match(host, /MAX_CONCURRENT_HANDSHAKES/u);
	assert.match(host, /deviceHostRefreshDelayMs/u);
	assert.match(host, /iceconnectionstatechange/u);
	assert.match(host, /handshakeGeneration/u);
	assert.match(host, /applyHandshakeSignal/u);
	// Liveness is explicit. No traffic-pattern inference survives in the host.
	assert.doesNotMatch(
		host,
		/stallClass|shouldFailHostedStall|laneCloseHangsUp/u,
	);
	assert.doesNotMatch(
		lifecycle,
		/stallClass|shouldFailHostedStall|laneCloseHangsUp/u,
	);
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
	const disconnected = [];
	// A native datachannel is not guaranteed to emit `close` before its peer is
	// torn down. The replacement path must not depend on that event, or a
	// superseded connection stays listed as live for the rest of the session.
	registry.set('device-a', {
		peer: { close: () => undefined },
		connection: { close: () => undefined },
		connectionId: 'connection-superseded',
	});
	const replaced = await registry.close('device-a');
	if (replaced?.connectionId !== undefined)
		disconnected.push(replaced.connectionId);
	assert.deepEqual(disconnected, ['connection-superseded']);
});


test('a device holds one live peer per window, and a reconnect replaces only its own', async () => {
	const order = [];
	const live = (name) => ({
		peer: { close: () => order.push(`peer:${name}`) },
		connection: { close: () => order.push(`connection:${name}`) },
	});
	const registry = new HostedLivePeerRegistry();
	const main = live('main');
	const settings = live('settings');
	registry.set('device-a', main, 'window-1');
	registry.set('device-a', settings, 'window-2');
	registry.set('device-b', live('b'), 'window-1');
	assert.equal(registry.size, 3);
	assert.equal(registry.countForDevice('device-a'), 2);

	// The second window did not disturb the first.
	assert.equal(registry.get('device-a', 'window-1'), main);
	assert.deepEqual(order, []);

	// A window reconnecting retires its own previous peer, connection first.
	assert.equal(await registry.close('device-a', 'window-1'), main);
	assert.deepEqual(order, ['connection:main', 'peer:main']);
	assert.equal(registry.get('device-a', 'window-2'), settings);
	assert.equal(registry.countForDevice('device-b'), 1);

	// Another device using the same window id names its own entry only.
	assert.equal(await registry.close('device-c', 'window-2'), undefined);
	assert.equal(registry.get('device-a', 'window-2'), settings);

	// A late teardown is matched by peer, whichever window it was.
	assert.equal(registry.drop('device-a', main.peer), undefined);
	assert.equal(registry.drop('device-a', settings.peer), settings);
	assert.equal(registry.countForDevice('device-a'), 0);
});

test('clients that name no window still replace each other', async () => {
	const registry = new HostedLivePeerRegistry();
	const first = { peer: { close: () => undefined } };
	const second = { peer: { close: () => undefined } };
	registry.set('device-a', first);
	assert.equal(await registry.close('device-a'), first);
	registry.set('device-a', second);
	assert.equal(registry.countForDevice('device-a'), 1);
	assert.equal(registry.get('device-a'), second);
	// The unnamed window and a named one are different windows.
	assert.equal(registry.get('device-a', 'window-1'), undefined);
});

test('closing a device closes every window it has, and nobody else', async () => {
	const closed = [];
	const live = (name) => ({
		peer: { close: () => closed.push(name) },
		connectionId: name,
	});
	const registry = new HostedLivePeerRegistry();
	registry.set('device-a', live('a1'), 'window-1');
	registry.set('device-a', live('a2'), 'window-2');
	registry.set('device-a', live('a0'));
	registry.set('device-b', live('b1'), 'window-1');

	const retired = await registry.closeDevice('device-a');
	assert.deepEqual(retired.map((entry) => entry.connectionId).sort(), [
		'a0',
		'a1',
		'a2',
	]);
	assert.deepEqual([...closed].sort(), ['a0', 'a1', 'a2']);
	assert.equal(registry.countForDevice('device-a'), 0);
	assert.equal(registry.countForDevice('device-b'), 1);
	assert.deepEqual(await registry.closeDevice('device-a'), []);
});

test('a device is refused a window past its limit, but never a reconnect', () => {
	const registry = new HostedLivePeerRegistry();
	const peer = () => ({ peer: { close: () => undefined } });
	for (let index = 0; index < MAX_LIVE_WINDOWS_PER_DEVICE; index += 1) {
		assert.equal(registry.admits('device-a', `window-${index}`), true);
		registry.set('device-a', peer(), `window-${index}`);
	}
	assert.equal(registry.admits('device-a', 'window-new'), false);
	assert.equal(registry.admits('device-a'), false);
	// Reconnecting an existing window is not a further window.
	assert.equal(registry.admits('device-a', 'window-3'), true);
	// Another device has its own allowance.
	assert.equal(registry.admits('device-b', 'window-new'), true);
	// Refusal closed nothing.
	assert.equal(registry.countForDevice('device-a'), MAX_LIVE_WINDOWS_PER_DEVICE);
});

test('a window id is a bounded identifier or it is refused', () => {
	assert.equal(readWindowId(undefined), '');
	assert.equal(readWindowId('w_1-Ab'), 'w_1-Ab');
	assert.equal(readWindowId('a'.repeat(64)), 'a'.repeat(64));
	for (const invalid of [
		'',
		'a'.repeat(65),
		'-leading',
		'has space',
		'a:b',
		'a.b',
		'a/b',
		'a\u0000b',
		null,
		7,
		{},
		['w'],
	])
		assert.equal(readWindowId(invalid), null);
});

test('revoking a device tells every pairing host, and a failing one cannot mask it', async () => {
	const { createServerRemoteExposure } = await import(
		'../dist/remote/serverExposure.js'
	);
	const exposure = createServerRemoteExposure({
		serverId: 'server-a',
		sessionOrigin: 'http://session.localhost:1',
		pairingUrlFormat: 'hosted-compact',
		cleanupIntervalMs: 0,
	});
	const told = [];
	// The hosted and the direct pairing host each watch the one exposure.
	const stopHosted = exposure.onDeviceRevoked((deviceId) =>
		told.push(`hosted:${deviceId}`),
	);
	exposure.onDeviceRevoked(() => {
		throw new Error('a host that fails to close its peers');
	});
	exposure.onDeviceRevoked((deviceId) => told.push(`direct:${deviceId}`));
	await exposure.revokeDevice('device-a');
	assert.deepEqual(told, ['hosted:device-a', 'direct:device-a']);
	stopHosted();
	await exposure.revokeDevice('device-b');
	assert.deepEqual(told.slice(2), ['direct:device-b']);
	await exposure.shutdown();
});
