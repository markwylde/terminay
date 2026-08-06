import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { ServerWebSocketByteTransport } from '../dist/webSocketByteTransport.js';

test('server WebSocket transport fails when the underlying socket closes before lifecycle notification', async () => {
	const socket = new FakeSocket();
	const transport = new ServerWebSocketByteTransport(socket, 16, 32);
	const states = [];
	transport.onStateChange((state, reason) =>
		states.push({ state, code: reason?.code }),
	);
	await transport.open();

	socket.readyState = FakeSocket.CLOSING;
	await assert.rejects(transport.send(new Uint8Array([1])), /failed|not open/u);
	assert.equal(transport.state, 'failed');
	assert.deepEqual(states, [
		{ state: 'open', code: undefined },
		{ state: 'failed', code: 'unavailable' },
	]);
});

test('server WebSocket transport observes callback and synchronous send failures once', async (t) => {
	for (const mode of ['callback', 'throw']) {
		await t.test(mode, async () => {
			const socket = new FakeSocket();
			socket.sendFailure = mode;
			const transport = new ServerWebSocketByteTransport(socket, 16, 32);
			const states = [];
			transport.onStateChange((state) => states.push(state));
			transport.onStateChange(() => {
				throw new Error('observer failure');
			});
			await transport.open();

			await assert.rejects(
				transport.send(new Uint8Array([1])),
				/scripted send failure/u,
			);
			await transport.close();
			assert.equal(transport.state, 'failed');
			assert.deepEqual(states, ['open', 'failed']);
			assert.equal(socket.closeCount, 1);
		});
	}
});

test('server WebSocket transport aborts a backpressure wait', async () => {
	const socket = new FakeSocket();
	socket.bufferedAmount = 32;
	const transport = new ServerWebSocketByteTransport(socket, 16, 32);
	await transport.open();
	const controller = new AbortController();
	const waiting = transport.waitForWritable(1, controller.signal);
	controller.abort(new Error('scripted abort'));
	await assert.rejects(waiting, /scripted abort/u);
	assert.equal(transport.state, 'open');
	await transport.close();
});

class FakeSocket extends EventEmitter {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSING = 2;
	static CLOSED = 3;
	readyState = FakeSocket.OPEN;
	bufferedAmount = 0;
	sendFailure = undefined;
	closeCount = 0;

	send(_frame, _options, callback) {
		if (this.sendFailure === 'throw') throw new Error('scripted send failure');
		if (this.sendFailure === 'callback')
			callback(new Error('scripted send failure'));
		else callback();
	}

	close(code = 1000, reason = '') {
		this.closeCount += 1;
		this.readyState = FakeSocket.CLOSED;
		this.emit('close', code, Buffer.from(reason));
	}
}
