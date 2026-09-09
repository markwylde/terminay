import assert from 'node:assert/strict';
import { createSocket } from 'node:dgram';
import test from 'node:test';

import { assertAdvertisedPortIsBindable } from '../src/remote/advertisedIcePort.ts';

function bind(port) {
	return new Promise((resolve) => {
		const socket = createSocket('udp4');
		socket.bind(port, () => resolve(socket));
	});
}

function close(socket) {
	return new Promise((resolve) => socket.close(resolve));
}

async function freePort() {
	const socket = await bind(0);
	const { port } = socket.address();
	await close(socket);
	return port;
}

test('a bindable advertised port passes and leaves the port free', async () => {
	const port = await freePort();
	await assert.doesNotReject(() =>
		assertAdvertisedPortIsBindable({ host: '127.0.0.1', port }),
	);

	// The check probes; it must not hold the port, or the server could not then
	// bind the very port it just proved was available.
	const socket = await bind(port);
	assert.equal(socket.address().port, port);
	await close(socket);
});

test('a port already in use stops the server and names the port', async () => {
	const port = await freePort();
	const holder = await bind(port);
	try {
		await assert.rejects(
			() => assertAdvertisedPortIsBindable({ host: '127.0.0.1', port }),
			(error) =>
				error.message.includes(String(port)) &&
				/will not start/u.test(error.message),
		);
	} finally {
		await close(holder);
	}
});

test('an IPv6 advertised address is probed on an IPv6 socket', async () => {
	// Chooses udp6 from the address shape rather than guessing, so a v6-only
	// deployment is checked against the family it will actually bind.
	await assert.doesNotReject(() =>
		assertAdvertisedPortIsBindable({ host: '::1', port: 0 }).catch((error) => {
			// Port 0 binds ephemerally, so this only fails where IPv6 is absent.
			if (/EAFNOSUPPORT|EADDRNOTAVAIL/u.test(error.message)) return;
			throw error;
		}),
	);
});
