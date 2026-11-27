import assert from 'node:assert/strict';
import test from 'node:test';
import { ByteStreamClient, RfbStreamChannel } from '../dist/client/index.js';

const operations = {
	read: 'thing.io.read',
	write: 'thing.io.write',
	finish: 'thing.io.finish',
	close: 'thing.io.close',
};

/** A transport that records every call and replays scripted reads. */
function transport(reads = []) {
	const calls = [];
	return {
		calls,
		async queryWithBody(operation, input) {
			calls.push(['query', operation, input]);
			const next = reads.shift();
			if (next === undefined) return { result: { done: true }, body: new Uint8Array() };
			return next;
		},
		async command(operation, input) {
			calls.push(['command', operation, input]);
			return null;
		},
		async commandWithBody(operation, input, body) {
			calls.push(['command', operation, input, Buffer.from(body).toString()]);
			return null;
		},
	};
}

test('a stream sends its whole handle back unchanged, whatever the handle holds', async () => {
	const handle = { streamId: 's-1', desktop: 'server', nested: { epoch: 4 } };
	const wire = transport([
		{ result: { done: false }, body: Buffer.from('ab') },
		{ result: { done: false }, body: Buffer.from('cd') },
	]);
	const stream = new ByteStreamClient(wire, operations, handle);
	await stream.write(Buffer.from('in'));
	const read = [];
	for await (const chunk of stream.read()) read.push(Buffer.from(chunk).toString());
	assert.deepEqual(read, ['ab', 'cd']);
	assert.deepEqual(wire.calls, [
		['command', 'thing.io.write', handle, 'in'],
		['query', 'thing.io.read', handle],
		['query', 'thing.io.read', handle],
		['query', 'thing.io.read', handle],
	]);
	// The server said done, so no close is sent.
	await stream.close();
	assert.equal(wire.calls.length, 4);
});

test('closing an open stream sends one close, and later use is refused', async () => {
	const wire = transport();
	const stream = new ByteStreamClient(wire, operations, { streamId: 's-2' }, 'thing');
	await stream.close();
	await stream.close();
	assert.deepEqual(wire.calls, [['command', 'thing.io.close', { streamId: 's-2' }]]);
	await assert.rejects(stream.write(new Uint8Array(1)), /thing stream closed/);
	await assert.rejects(stream.finish(), /thing stream closed/);
});

test('an oversized chunk and a malformed read are refused', async () => {
	const wire = transport([{ result: { done: 'no' }, body: new Uint8Array() }]);
	const stream = new ByteStreamClient(wire, operations, { streamId: 's-3' });
	await assert.rejects(
		stream.write(new Uint8Array(1024 * 1024 + 1)),
		/desktop stream chunk too large/,
	);
	await assert.rejects(async () => {
		for await (const _ of stream.read()) {
			// unreachable
		}
	}, /invalid desktop stream response/);
});

test('the RFB channel carries any byte stream, in order, and closes it once', async () => {
	const written = [];
	let closes = 0;
	let release;
	const stream = {
		async *read() {
			yield Buffer.from('one');
			await new Promise((resolve) => {
				release = resolve;
			});
		},
		async write(bytes) {
			written.push(Buffer.from(bytes).toString());
		},
		async close() {
			closes += 1;
		},
	};
	const channel = new RfbStreamChannel(stream);
	const received = [];
	let closed = 0;
	channel.onmessage = (event) => received.push(Buffer.from(event.data).toString());
	channel.onclose = () => {
		closed += 1;
	};
	channel.start();
	channel.send(Buffer.from('a'));
	channel.send(Buffer.from('b'));
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(received, ['one']);
	assert.deepEqual(written, ['a', 'b']);
	channel.close();
	channel.close();
	channel.send(Buffer.from('late'));
	release();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(closed, 1);
	assert.equal(closes, 1);
	assert.deepEqual(written, ['a', 'b']);
});
