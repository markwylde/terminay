import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	DEVICE_HOST_AVAILABILITY_MS,
	DEVICE_REFRESH_LEAD_MS,
	deviceHostRefreshDelayMs,
	HostedGenerationSet,
} from '../src/remote/hostedPeerLifecycle.ts';

test('retired generations leave the live set so later hydrates are not sent into dead peers', () => {
	const closed = [];
	const connections = [];
	const set = new HostedGenerationSet();
	const peerA = { close() { closed.push('a'); } };
	const peerB = { close() { closed.push('b'); } };
	set.add({
		peer: peerA,
		connection: { close() { connections.push('a'); } },
	});
	set.add({
		peer: peerB,
		connection: { close() { connections.push('b'); } },
	});
	assert.equal(set.size, 2);
	assert.equal(set.drop(peerA)?.peer, peerA);
	assert.equal(set.size, 1);
	set.closeAll();
	assert.deepEqual(closed, ['b']);
	assert.deepEqual(connections, ['b']);
	assert.equal(set.size, 0);
});

test('a reconnect storm of retired generations does not keep them in the live set', () => {
	const set = new HostedGenerationSet();
	const live = { close() {} };
	for (let i = 0; i < 32; i += 1) {
		const peer = { close() {} };
		set.add({ peer });
		set.drop(peer);
	}
	set.add({ peer: live });
	assert.equal(set.size, 1);
	assert.equal(set.drop(live)?.peer, live);
	assert.equal(set.size, 0);
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
