import assert from 'node:assert/strict';
import test from 'node:test';
import {
	advertisedPairingUrlClass,
	pairingUrlForEndpoint,
} from '../dist/remote/publicPairingUrl.js';

test('wildcard listener addresses never replace a valid hosted pairing URL', () => {
	const handoff = {
		pairingUrl:
			'https://app.terminay.com/?s=server123&hostName=container#secret',
	};
	assert.equal(
		pairingUrlForEndpoint(handoff, 'https://0.0.0.0:9443'),
		handoff.pairingUrl,
	);
	assert.equal(
		pairingUrlForEndpoint(handoff, 'https://[::]:9443'),
		handoff.pairingUrl,
	);
});

test('advertised URL diagnostics distinguish direct loopback links from hosted links', () => {
	assert.equal(
		advertisedPairingUrlClass('https://localhost:9443/v1/#secret'),
		'direct',
	);
	assert.equal(
		advertisedPairingUrlClass('https://app.terminay.com/?s=server123#secret'),
		'manager',
	);
	assert.equal(
		advertisedPairingUrlClass('https://server123.terminay.com/v1/#secret'),
		'session',
	);
});
