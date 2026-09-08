import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultDirectOrigin, originFor, primaryAddress } from '../dist/address.js';

function fakeSocket({ address, connectThrows = false, emitError = false }) {
	const handlers = new Map();
	return {
		on(event, handler) {
			handlers.set(event, handler);
		},
		connect(_port, _host, callback) {
			if (connectThrows) throw new Error('no route to host');
			if (emitError) {
				queueMicrotask(() => handlers.get('error')?.(new Error('network unreachable')));
				return;
			}
			queueMicrotask(callback);
		},
		address() {
			if (address === undefined) throw new Error('not bound');
			return { address };
		},
		close() {},
	};
}

test('the probe reports the source address the routing table would use', async () => {
	const probe = () => fakeSocket({ address: '198.51.100.7' });
	assert.equal(await primaryAddress(probe), '198.51.100.7');
	assert.equal(await defaultDirectOrigin(8443, probe), 'https://198.51.100.7:8443');
});

test('a host with no route yields no origin rather than a wrong one', async () => {
	assert.equal(await primaryAddress(() => fakeSocket({ connectThrows: true })), undefined);
	assert.equal(await defaultDirectOrigin(8443, () => fakeSocket({ connectThrows: true })), undefined);
	assert.equal(await primaryAddress(() => fakeSocket({ emitError: true })), undefined);
	assert.equal(await primaryAddress(() => fakeSocket({ address: undefined })), undefined);
	assert.equal(
		await primaryAddress(() => {
			throw new Error('no socket could be opened');
		}),
		undefined,
	);
});

test('the probe sends nothing and closes the socket it opened', async () => {
	let closed = false;
	const socket = fakeSocket({ address: '10.0.0.5' });
	const originalClose = socket.close;
	socket.close = () => {
		closed = true;
		originalClose();
	};
	assert.equal(await primaryAddress(() => socket), '10.0.0.5');
	assert.equal(closed, true, 'the probe socket must not be left open');
	assert.equal(typeof socket.send, 'undefined', 'the probe must never send a packet');
});

test('an IPv6 address is bracketed so the origin parses', () => {
	assert.equal(originFor('2001:db8::1', 8443), 'https://[2001:db8::1]:8443');
	assert.equal(new URL(originFor('2001:db8::1', 8443)).port, '8443');
	assert.equal(originFor('198.51.100.7', 8443), 'https://198.51.100.7:8443');
});

test('the real probe answers on a machine with a route, and never throws without one', async () => {
	// Exercises the default factory rather than a stub; either answer is valid
	// depending on the host, but it must resolve rather than reject.
	const address = await primaryAddress();
	assert.ok(address === undefined || typeof address === 'string');
});
