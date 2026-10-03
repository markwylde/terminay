import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { hostedPeerConfiguration } from '../src/remote/hostedPeerLifecycle.ts';
import { loadSelectedSecureWeriftRuntime } from '../src/remote/secureWeriftRuntime.ts';

/**
 * A pinned ICE range is a budget every live peer draws from: the runtime gives
 * each candidate of each peer its own socket, and two sockets of one address
 * family cannot share a port. That is a property of the WebRTC runtime, not of
 * our configuration, so it is measured against the real runtime. It is why a
 * server pins a range only when asked, and why the length is configurable.
 */

const RUNTIME_ROOT = resolve(
	new URL('../../..', import.meta.url).pathname,
	'build/webrtc-runtime',
);
const AVAILABLE = existsSync(resolve(RUNTIME_ROOT, 'artifact/lib/index.mjs'));

function candidatePorts(sdp) {
	return sdp
		.split(/\r?\n/u)
		.filter((line) => line.startsWith('a=candidate:'))
		.map((line) => Number(line.split(' ')[5]));
}

/**
 * Open peers under one pinned range, keeping each alive, until one gathers
 * nothing. Returns the ports each live peer holds.
 */
async function fillRange(runtime, firstPort, span, limit) {
	const peers = [];
	const held = [];
	try {
		for (let index = 0; index < limit; index += 1) {
			const peer = new runtime.RTCPeerConnection(
				hostedPeerConfiguration('example.terminay.com', [], [], undefined, {
					firstPort,
					span,
				}),
			);
			peers.push(peer);
			peer.createDataChannel('api');
			await peer.setLocalDescription(await peer.createOffer());
			let ports = [];
			for (let attempt = 0; attempt < 30 && ports.length === 0; attempt += 1) {
				await new Promise((settle) => setTimeout(settle, 100));
				ports = candidatePorts(peer.localDescription?.sdp ?? '');
			}
			if (ports.length === 0) break;
			held.push(ports);
		}
		return held;
	} finally {
		for (const peer of peers) peer.close();
		// Let the sockets go before the next range is measured.
		await new Promise((settle) => setTimeout(settle, 300));
	}
}

test('a pinned range bounds how many peers can gather, and a longer one serves more', {
	skip: AVAILABLE ? false : `selected WebRTC runtime is not staged at ${RUNTIME_ROOT}`,
	timeout: 120_000,
}, async () => {
	const runtime = await loadSelectedSecureWeriftRuntime(RUNTIME_ROOT);

	const short = await fillRange(runtime, 53_100, 4, 8);
	assert.ok(short.length >= 1, 'the first peer under a pinned range gathers');
	assert.ok(
		short.length < 8,
		'a four-port range cannot serve eight peers at once: it is a budget',
	);
	for (const port of short.flat()) {
		assert.ok(port >= 53_100 && port <= 53_103, `port ${port} left the range`);
	}

	const long = await fillRange(runtime, 53_200, 16, 20);
	assert.ok(
		long.length > short.length,
		`a sixteen-port range served ${long.length} peers, no more than the ${short.length} a four-port one did`,
	);
	for (const port of long.flat()) {
		assert.ok(port >= 53_200 && port <= 53_215, `port ${port} left the range`);
	}
});

test('an unpinned server is not bounded by a range', {
	skip: AVAILABLE ? false : `selected WebRTC runtime is not staged at ${RUNTIME_ROOT}`,
	timeout: 120_000,
}, async () => {
	const runtime = await loadSelectedSecureWeriftRuntime(RUNTIME_ROOT);
	const peers = [];
	try {
		for (let index = 0; index < 8; index += 1) {
			const peer = new runtime.RTCPeerConnection(
				hostedPeerConfiguration('example.terminay.com', [], []),
			);
			peers.push(peer);
			peer.createDataChannel('api');
			await peer.setLocalDescription(await peer.createOffer());
			let ports = [];
			for (let attempt = 0; attempt < 30 && ports.length === 0; attempt += 1) {
				await new Promise((settle) => setTimeout(settle, 100));
				ports = candidatePorts(peer.localDescription?.sdp ?? '');
			}
			assert.ok(ports.length > 0, `peer ${index + 1} of 8 gathered nothing`);
		}
	} finally {
		for (const peer of peers) peer.close();
	}
});
