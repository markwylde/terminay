import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { WebSocket } from 'ws';
import { createDirectSignalingRelay } from '../dist/remote/directSignalingRelay.js';

const SESSION_HOST = 'box.example.test:8443';
const SESSION_ORIGIN = `https://${SESSION_HOST}`;
const MANAGER_ORIGIN = 'https://app.example.test';

async function startRelay(overrides = {}) {
	const relay = createDirectSignalingRelay({
		sessionOrigin: SESSION_ORIGIN,
		managerOrigin: MANAGER_ORIGIN,
		...overrides,
	});
	const http = createServer((_request, response) => {
		response.writeHead(404).end();
	});
	http.on('upgrade', (request, socket, head) => relay.handleUpgrade(request, socket, head));
	await new Promise((resolveListen) => http.listen(0, '127.0.0.1', resolveListen));
	const port = http.address().port;
	const open = [];
	return {
		relay,
		port,
		// The listener terminates TLS in production; the routing boundary is the
		// Host header, which is what this drives directly.
		async connect(host = SESSION_HOST, path = '/signal') {
			const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: { host } });
			open.push(socket);
			const frames = [];
			socket.on('message', (raw) => frames.push(JSON.parse(String(raw))));
			await Promise.race([
				once(socket, 'open'),
				once(socket, 'error').then(([error]) => {
					throw error;
				}),
			]);
			return {
				socket,
				frames,
				send: (frame) => socket.send(JSON.stringify(frame)),
				closes: new Promise((resolveClose) => socket.once('close', (code, reason) => resolveClose({ code, reason: String(reason) }))),
			};
		},
		async close() {
			for (const socket of open) socket.terminate();
			await relay.close();
			await new Promise((resolveClose) => http.close(resolveClose));
		},
	};
}

function waitFor(predicate, label, timeoutMs = 5_000) {
	return new Promise((resolveWait, reject) => {
		const startedAt = Date.now();
		const tick = () => {
			if (predicate()) return resolveWait();
			if (Date.now() - startedAt > timeoutMs) return reject(new Error(`timed out waiting for ${label}`));
			setTimeout(tick, 10);
		};
		tick();
	});
}

test('the relay routes the hosted frame vocabulary between one host and its joining client', async (t) => {
	const harness = await startRelay();
	t.after(() => harness.close());

	const host = await harness.connect();
	host.send({ type: 'host-ready', roomId: 'pair-room' });
	host.send({ type: 'device-host-ready', sessionId: 'session-1' });
	await waitFor(() => host.frames.length === 2, 'both host registrations to be acknowledged');
	assert.deepEqual(host.frames, [
		{ type: 'host-registered', roomId: 'pair-room' },
		{ type: 'device-host-registered', sessionId: 'session-1' },
	]);
	assert.equal(harness.relay.status().pairingHostRegistered, true);
	assert.equal(harness.relay.status().deviceHostRegistered, true);

	const client = await harness.connect();
	client.send({ type: 'client-join', roomId: 'pair-room', clientNonce: 'nonce', opaque: { transcript: 'x' } });
	await waitFor(() => host.frames.length === 3, 'the join to reach the host');
	// The frame is forwarded exactly as it arrived: nothing in it is parsed
	// beyond the type and the room.
	assert.deepEqual(host.frames[2], {
		type: 'client-join',
		roomId: 'pair-room',
		clientNonce: 'nonce',
		opaque: { transcript: 'x' },
	});

	host.send({ type: 'offer', sdp: 'opaque-offer' });
	await waitFor(() => client.frames.length === 1, 'the offer to reach the client');
	assert.deepEqual(client.frames[0], { type: 'offer', sdp: 'opaque-offer' });

	client.send({ type: 'answer', sdp: 'opaque-answer' });
	client.send({ type: 'ice', candidate: 'opaque-candidate' });
	await waitFor(() => host.frames.length === 5, 'the answer and candidate to reach the host');
	assert.deepEqual(host.frames.slice(3), [
		{ type: 'answer', sdp: 'opaque-answer' },
		{ type: 'ice', candidate: 'opaque-candidate' },
	]);

	// The device plane routes independently of the pairing plane.
	const deviceClient = await harness.connect();
	deviceClient.send({ type: 'device-join', sessionId: 'session-1', deviceId: 'device-1' });
	await waitFor(() => host.frames.length === 6, 'the device join to reach the host');
	host.send({ type: 'device-offer', sdp: 'opaque-device-offer' });
	await waitFor(() => deviceClient.frames.length === 1, 'the device offer to reach the device');
	assert.equal(client.frames.length, 1, 'the pairing client must not see device-plane frames');
});

test('a second host registration is refused rather than taking the room over', async (t) => {
	const harness = await startRelay();
	t.after(() => harness.close());

	const host = await harness.connect();
	host.send({ type: 'host-ready', roomId: 'pair-room' });
	await waitFor(() => host.frames.length === 1, 'the first registration');

	const impostor = await harness.connect();
	impostor.send({ type: 'host-ready', roomId: 'other-room' });
	const closed = await impostor.closes;
	assert.equal(closed.code, 1008);
	assert.equal(closed.reason, 'host-already-registered');
	assert.equal(harness.relay.status().pairingRoomId, 'pair-room');

	// The original host keeps the room and keeps routing.
	const client = await harness.connect();
	client.send({ type: 'client-join', roomId: 'pair-room' });
	await waitFor(() => host.frames.length === 2, 'the join to reach the original host');
});

test('joins are capped per room and per window, and unknown rooms are refused', async (t) => {
	const harness = await startRelay({ roomHandshakes: 2, handshakeWindowMs: 60_000 });
	t.after(() => harness.close());

	const host = await harness.connect();
	host.send({ type: 'host-ready', roomId: 'pair-room' });
	await waitFor(() => host.frames.length === 1, 'the registration');

	for (let index = 0; index < 2; index += 1) {
		const client = await harness.connect();
		client.send({ type: 'client-join', roomId: 'pair-room' });
		await waitFor(() => host.frames.length === index + 2, `join ${index + 1}`);
	}

	const excess = await harness.connect();
	excess.send({ type: 'client-join', roomId: 'pair-room' });
	const refused = await excess.closes;
	assert.equal(refused.reason, 'handshake-limit');
	assert.equal(host.frames.length, 3, 'a capped join never reaches the host');

	const wrongRoom = await harness.connect();
	wrongRoom.send({ type: 'client-join', roomId: 'someone-elses-room' });
	assert.equal((await wrongRoom.closes).reason, 'unknown-room');
});

test('a join with no registered host is refused', async (t) => {
	const harness = await startRelay();
	t.after(() => harness.close());

	const client = await harness.connect();
	client.send({ type: 'client-join', roomId: 'pair-room' });
	assert.equal((await client.closes).reason, 'no-registered-host');
});

test('oversized and unroutable frames never reach a peer', async (t) => {
	const harness = await startRelay({ maxFrameBytes: 1_024 });
	t.after(() => harness.close());

	const host = await harness.connect();
	host.send({ type: 'host-ready', roomId: 'pair-room' });
	await waitFor(() => host.frames.length === 1, 'the registration');

	const client = await harness.connect();
	client.send({ type: 'client-join', roomId: 'pair-room' });
	await waitFor(() => host.frames.length === 2, 'the join');

	client.socket.send(JSON.stringify({ type: 'answer', sdp: 'x'.repeat(4_096) }));
	const closed = await client.closes;
	assert.equal(closed.code, 1009, 'an oversized frame closes the connection');
	assert.equal(host.frames.length, 2, 'an oversized frame is never forwarded');

	const noisy = await harness.connect();
	noisy.socket.send('not json');
	assert.equal((await noisy.closes).reason, 'unroutable-frame');
	assert.equal(host.frames.length, 2);
});

test('the upgrade boundary refuses the manager host, a foreign host, and a foreign path', async (t) => {
	const harness = await startRelay();
	t.after(() => harness.close());

	for (const [host, path] of [
		['app.example.test', '/signal'],
		['attacker.example', '/signal'],
		[SESSION_HOST, '/signal/../admin'],
	]) {
		await assert.rejects(
			() => harness.connect(host, path),
			/socket hang up|Unexpected server response|ECONNRESET/u,
			`${host}${path} must not become a signaling endpoint`,
		);
	}
});
