import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ADVERTISED_PORT,
	ADVERTISED_SPAN,
	CONTAINER_PEER,
	isEnabled,
	proveAdvertisedReachability,
} from './advertised-ice-reachability.mjs';

test('the reachability proof is opt-in', () => {
	assert.equal(isEnabled({}), false);
	assert.equal(isEnabled({ TERMINAY_RUN_DAEMON_SMOKE: '1' }), true);
});

test('the containerised peer advertises rather than relying on its own address', () => {
	// It must set both halves: the address to offer, and the port range that makes
	// that address forwardable.
	assert.match(CONTAINER_PEER, /iceAdditionalHostAddresses/u);
	assert.match(CONTAINER_PEER, /icePortRange/u);
	assert.equal(
		ADVERTISED_SPAN >= 2,
		true,
		'the runtime rejects a single-port range',
	);
});

test('a client connects to a containerised peer over the advertised candidate', {
	skip: !isEnabled(),
}, async () => {
	// The scenario the option exists for. The container's own address is not
	// routable from the host, so a completed connection can only have used the
	// advertised candidate — and the assertion below checks it was offered.
	const result = await proveAdvertisedReachability();
	assert.match(
		result.candidates,
		new RegExp(` 127\\.0\\.0\\.1 ${ADVERTISED_PORT} typ host`, 'u'),
	);
	assert.equal(
		result.received,
		'from-container',
		'data must cross, not merely ICE',
	);
});
