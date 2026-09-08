import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ECHO_SERVER,
	isEnabled,
	provePublishedUdpPort,
} from './published-udp-port.mjs';

test('the probe is opt-in, like every other container check', () => {
	assert.equal(isEnabled({}), false);
	assert.equal(isEnabled({ TERMINAY_RUN_DAEMON_SMOKE: '0' }), false);
	assert.equal(isEnabled({ TERMINAY_RUN_DAEMON_SMOKE: '1' }), true);
});

test('the probe asserts a round trip, not merely that a datagram was sent', () => {
	// A UDP send succeeds locally whether or not anything receives it, so the
	// check has to be an echo the sender recognises.
	assert.match(ECHO_SERVER, /socket\.send\(/u);
	assert.match(ECHO_SERVER, /pong:/u);
});

test('a published UDP port round-trips through the container runtime', {
	skip: !isEnabled(),
}, async () => {
	// `--advertise-address` is only useful if this holds. It runs through a VM
	// and a userspace proxy on macOS and Windows, so it is an assumption about
	// someone else's software and worth re-proving rather than remembering.
	const result = await provePublishedUdpPort();
	assert.equal(typeof result.port, 'number');
});
