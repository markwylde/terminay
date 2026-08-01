import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = await mkdtemp(
	join(tmpdir(), 'terminay-hosted-registration-'),
);
const output = join(directory, 'registration.cjs');
await build({
	bundle: true,
	entryPoints: ['electron/remote/hostedSignalingRegistration.ts'],
	format: 'cjs',
	logLevel: 'silent',
	outfile: output,
	platform: 'node',
	target: 'node20',
});
const imported = await import(pathToFileURL(output).href);
const { createHostedSignalingRoomRegistrar, deriveHostedRegistrationMaterial } =
	imported.default ?? imported;
test.after(async () => rm(directory, { force: true, recursive: true }));

class FakeSocket {
	readyState = 0;
	listeners = new Map();
	sent = [];
	closed = [];
	on(event, listener) {
		const listeners = this.listeners.get(event) ?? [];
		listeners.push(listener);
		this.listeners.set(event, listeners);
	}
	emit(event, value) {
		for (const listener of this.listeners.get(event) ?? []) listener(value);
	}
	send(value) {
		this.sent.push(JSON.parse(value));
	}
	close(code, reason) {
		this.closed.push({ code, reason });
		this.readyState = 3;
		this.emit('close');
	}
}

const secret = Buffer.alloc(32, 7).toString('base64url');
const handoff = {
	expiresAt: Date.now() + 60_000,
	pairingUrl: `http://0123456789abcdef0123456789abcdef.localhost:4317/v1/#${secret}`,
	secret,
};

test('hosted registrar sends only derived room material and awaits acknowledgement', async () => {
	const socket = new FakeSocket();
	const registrar = createHostedSignalingRoomRegistrar({
		openSocket: (url, origin) => {
			assert.equal(
				url,
				'ws://0123456789abcdef0123456789abcdef.localhost:4317/signal',
			);
			assert.equal(
				origin,
				'http://0123456789abcdef0123456789abcdef.localhost:4317',
			);
			queueMicrotask(() => {
				socket.readyState = 1;
				socket.emit('open');
				const sent = socket.sent[0];
				socket.emit(
					'message',
					JSON.stringify({ roomId: sent.roomId, type: 'host-registered' }),
				);
			});
			return socket;
		},
	});
	// Room registration is not the authenticated per-peer signaling factory
	// required by secure-Werift production composition.
	assert.equal(registrar.createSignaling, undefined);
	const registration = await registrar.register(handoff);
	assert.equal(registration.active, true);
	assert.equal(socket.sent.length, 1);
	assert.deepEqual(Object.keys(socket.sent[0]).sort(), [
		'expiresAt',
		'relayJoinTokenHash',
		'roomId',
		'type',
	]);
	assert.equal(JSON.stringify(socket.sent[0]).includes(secret), false);
	socket.emit('message', 'not-json');
	socket.emit(
		'message',
		JSON.stringify({ roomId: 'another-room', type: 'client-join' }),
	);
	assert.equal(socket.sent.length, 1);
	socket.emit(
		'message',
		JSON.stringify({ roomId: registration.roomId, type: 'client-join' }),
	);
	assert.deepEqual(socket.sent[1], {
		roomId: registration.roomId,
		type: 'room-complete',
	});
	assert.equal(JSON.stringify(socket.sent[1]).includes(secret), false);
	assert.equal(registration.active, false);
	assert.equal(socket.closed.length, 1);
});

test('hosted registration derivation matches the compact v1 contract deterministically', () => {
	const first = deriveHostedRegistrationMaterial(handoff);
	const second = deriveHostedRegistrationMaterial(handoff);
	assert.deepEqual(first, second);
	assert.match(first.roomId, /^[A-Za-z0-9_-]{43}$/u);
	assert.match(first.relayJoinTokenHash, /^[A-Za-z0-9_-]{43}$/u);
	assert.equal(JSON.stringify(first).includes(secret), false);
});

test('hosted registration rejects non-canonical compact secrets before opening a socket', async () => {
	let opened = 0;
	const registrar = createHostedSignalingRoomRegistrar({
		openSocket: () => {
			opened += 1;
			return new FakeSocket();
		},
	});
	for (const invalidSecret of [
		`${secret}=`,
		`${secret.slice(0, -1)}+`,
		`${secret.slice(0, -1)}%`,
	]) {
		await assert.rejects(
			registrar.register({
				...handoff,
				pairingUrl: `http://0123456789abcdef0123456789abcdef.localhost:4317/v1/#${invalidSecret}`,
				secret: invalidSecret,
			}),
			/hosted pairing handoff is invalid/iu,
		);
	}
	assert.equal(opened, 0);
});

test('hosted registration expires once and releases its relay room', async () => {
	const socket = new FakeSocket();
	const expiresAt = Date.now() + 20;
	const registrar = createHostedSignalingRoomRegistrar({
		openSocket: () => {
			queueMicrotask(() => {
				socket.readyState = 1;
				socket.emit('open');
				socket.emit(
					'message',
					JSON.stringify({
						roomId: socket.sent[0].roomId,
						type: 'host-registered',
					}),
				);
			});
			return socket;
		},
	});
	const registration = await registrar.register({
		...handoff,
		expiresAt,
	});
	assert.equal(registration.active, true);
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.equal(registration.active, false);
	assert.deepEqual(socket.sent.at(-1), {
		roomId: registration.roomId,
		type: 'room-complete',
	});
	assert.equal(socket.closed.length, 1);
});

test('hosted registrar fails closed on rejection', async () => {
	const socket = new FakeSocket();
	const registrar = createHostedSignalingRoomRegistrar({
		openSocket: () => {
			queueMicrotask(() => {
				socket.readyState = 1;
				socket.emit('open');
				socket.emit(
					'message',
					JSON.stringify({
						message: 'rejected',
						roomId: socket.sent[0].roomId,
						type: 'error',
					}),
				);
			});
			return socket;
		},
	});
	await assert.rejects(registrar.register(handoff), /rejected/u);
	assert.equal(socket.closed.length, 1);
});
