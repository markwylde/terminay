import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
	ADVERTISED_PORT_SPAN,
	hostedPeerConfiguration,
} from '../src/remote/hostedPeerLifecycle.ts';
import { loadSelectedSecureWeriftRuntime } from '../src/remote/secureWeriftRuntime.ts';

/**
 * The advertised address is only useful if the WebRTC runtime actually puts it
 * in the offer, on the port it was told to bind. Everything else about this
 * feature is our own code passing a value along; this is the part where another
 * library has to honour it, so it is proven against the real runtime rather
 * than asserted about a configuration object.
 */

const RUNTIME_ROOT = resolve(
	new URL('../../..', import.meta.url).pathname,
	'build/webrtc-runtime',
);
const AVAILABLE = existsSync(resolve(RUNTIME_ROOT, 'selection.json'));

const ADVERTISED = { host: '198.51.100.9', port: 51_000 };

function candidateLines(sdp) {
	return sdp
		.split(/\r?\n/u)
		.filter((line) => line.startsWith('a=candidate:'))
		.map((line) => line.slice('a=candidate:'.length));
}

async function offerWith(advertise) {
	const runtime = await loadSelectedSecureWeriftRuntime(RUNTIME_ROOT);
	const peer = new runtime.RTCPeerConnection(
		hostedPeerConfiguration('example.terminay.com', [], [], advertise),
	);
	try {
		peer.createDataChannel('api');
		const offer = await peer.createOffer();
		await peer.setLocalDescription(offer);
		// Gathering is asynchronous; the local description accumulates candidates.
		for (let attempt = 0; attempt < 40; attempt += 1) {
			const sdp = peer.localDescription?.sdp ?? '';
			if (candidateLines(sdp).length > 0) return sdp;
			await new Promise((settle) => setTimeout(settle, 100));
		}
		return peer.localDescription?.sdp ?? '';
	} finally {
		peer.close();
	}
}

test('the offer carries the advertised address on the advertised port', {
	skip: !AVAILABLE && 'the selected WebRTC runtime is not staged',
}, async () => {
	const sdp = await offerWith(ADVERTISED);
	const candidates = candidateLines(sdp);
	assert.ok(candidates.length > 0, 'the peer gathered no candidates at all');

	const advertised = candidates.filter((line) =>
		line.includes(` ${ADVERTISED.host} `),
	);
	assert.ok(
		advertised.length > 0,
		`no candidate named ${ADVERTISED.host}:\n${candidates.join('\n')}`,
	);
	// The port is the whole point: a candidate on an ephemeral port could not
	// have been forwarded in advance.
	assert.ok(
		advertised.some((line) =>
			line.includes(` ${ADVERTISED.host} ${ADVERTISED.port} `),
		),
		`the advertised candidate is not on port ${ADVERTISED.port}:\n${advertised.join('\n')}`,
	);
	assert.ok(
		advertised.some((line) => /typ host/u.test(line)),
		'the advertised candidate is not a host candidate',
	);
});

test('the advertised candidate keeps its socket when the range is a budget', {
	skip: !AVAILABLE && 'the selected WebRTC runtime is not staged',
}, async () => {
	// The runtime gives every candidate its own socket from the pinned range,
	// so the range is a budget: a host with more local addresses than ports
	// offers fewer of them than it would unpinned. That is the cost of a range
	// an operator can publish in one line.
	//
	// What must not happen is the advertised address losing its socket to a
	// gathered one — it is the only candidate the client can actually reach,
	// and the reason the option was set.
	const with_ = candidateLines(await offerWith(ADVERTISED));
	assert.ok(
		with_.some((line) =>
			line.includes(` ${ADVERTISED.host} ${ADVERTISED.port} `),
		),
		`the advertised candidate lost its socket:\n${with_.join('\n')}`,
	);

	// Every offered candidate sits inside the published range, so an operator
	// forwarding that range has forwarded all of them.
	for (const line of with_) {
		const port = Number(line.split(' ')[5]);
		assert.ok(
			port >= ADVERTISED.port && port < ADVERTISED.port + ADVERTISED_PORT_SPAN,
			`candidate outside the published range: ${line}`,
		);
	}
});

test('without an advertised address the server gathers freely', {
	skip: !AVAILABLE && 'the selected WebRTC runtime is not staged',
}, async () => {
	// The budget applies only when an operator asked for it. An ordinary
	// server still offers every address it has, on ephemeral ports.
	const without = candidateLines(await offerWith(undefined));
	assert.ok(without.length > 0);
	assert.ok(
		without.some((line) => {
			const port = Number(line.split(' ')[5]);
			return (
				port < ADVERTISED.port || port >= ADVERTISED.port + ADVERTISED_PORT_SPAN
			);
		}),
		'an unpinned server should not be confined to the advertised range',
	);
});
