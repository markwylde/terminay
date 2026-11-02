import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';
import {
	BotDesktopService,
	BotRfbClientFilter,
	botVncChallengeResponse,
} from '../dist/botService/index.js';

const id = 'abc123def456';
const authority = (controller = new AbortController()) => ({
	connectionId: 'connection',
	clientId: 'client',
	authScope: 'write',
	signal: controller.signal,
	assertCurrent: () => {},
});
const word = (value, bytes = 4) => {
	const b = Buffer.alloc(bytes);
	if (bytes === 4) b.writeUInt32BE(value);
	else b.writeUInt16BE(value);
	return b;
};
const pixel = Buffer.from([
	32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0, 0, 0, 0,
]);
const setPixel = Buffer.concat([Buffer.alloc(4), pixel]);
const update = Buffer.from([3, 1, 0, 0, 0, 0, 0, 10, 0, 10]),
	key = Buffer.from([4, 1, 0, 0, 0, 0, 0, 65]),
	pointer = Buffer.from([5, 1, 0, 2, 0, 3]);
const clipboard = Buffer.concat([
	Buffer.from([6, 0, 0, 0]),
	word(5),
	Buffer.from('hello'),
]);
test('4.11 allowlist reassembles fragmented messages and discards forged view-only input', () => {
	const input = Buffer.concat([
		setPixel,
		Buffer.from([2, 0, 0, 1, 0, 0, 0, 0]),
		update,
		key,
		pointer,
		clipboard,
	]);
	for (let split = 0; split <= input.length; split++) {
		const f = new BotRfbClientFilter('view-only');
		assert.deepEqual(
			Buffer.concat([
				f.push(input.subarray(0, split)),
				f.push(input.subarray(split)),
			]),
			input.subarray(0, setPixel.length + 8 + update.length),
		);
	}
	const control = new BotRfbClientFilter('control');
	assert.deepEqual(control.push(input), input);
	const bytewise = new BotRfbClientFilter('view-only');
	const out = [];
	for (const b of input) out.push(bytewise.push(Buffer.from([b])));
	assert.deepEqual(Buffer.concat(out), input.subarray(0, 38));
});
test('4.11 unknown message types, encoding count, clipboard size, pixel bounds and 4 MiB cap fail closed', () => {
	for (const input of [
		Buffer.from([255]),
		Buffer.from([2, 0, 0, 65]),
		Buffer.concat([Buffer.from([6, 0, 0, 0]), word(1024 * 1024 + 1)]),
		Buffer.alloc(4 * 1024 * 1024 + 1),
		Buffer.alloc(20),
	])
		assert.throws(() => new BotRfbClientFilter('view-only').push(input));
	const f = new BotRfbClientFilter('control');
	assert.equal(f.push(Buffer.from([6, 0, 0, 0])).length, 0);
	assert.throws(() => f.push(word(1024 * 1024 + 1)));
});
function fakeVnc({ badAuth = false } = {}) {
	const source = new PassThrough(),
		writes = [];
	let stage = 0,
		pending = Buffer.alloc(0),
		killed = 0;
	const challenge = Buffer.from('0123456789abcdef');
	const serverInit = Buffer.concat([
		word(1440, 2),
		word(900, 2),
		pixel,
		word(4),
		Buffer.from('fake'),
	]);
	const sink = new Writable({
		write(chunk, _enc, done) {
			pending = Buffer.concat([pending, chunk]);
			while (true) {
				const size =
					stage === 0
						? 12
						: stage === 1
							? 1
							: stage === 2
								? 16
								: stage === 3
									? 1
									: 0;
				if (pending.length < size) break;
				if (stage === 4) {
					writes.push(pending);
					pending = Buffer.alloc(0);
					break;
				}
				const part = pending.subarray(0, size);
				pending = pending.subarray(size);
				if (stage === 0) {
					assert.equal(part.toString(), 'RFB 003.008\n');
					stage++;
					source.write(Buffer.from([1, 2]));
				} else if (stage === 1) {
					assert.equal(part[0], 2);
					stage++;
					source.write(challenge);
				} else if (stage === 2) {
					assert.deepEqual(
						part,
						botVncChallengeResponse(Buffer.from('fake-pass'), challenge),
					);
					stage++;
					source.write(word(badAuth ? 1 : 0));
				} else {
					assert.equal(part[0], 1);
					stage++;
					source.write(serverInit);
				}
				if (!pending.length) break;
			}
			done();
		},
	});
	const child = new EventEmitter();
	Object.assign(child, {
		stdout: source,
		stdin: sink,
		stderr: new PassThrough(),
		kill: () => {
			killed++;
			source.destroy();
			sink.destroy();
			return true;
		},
	});
	queueMicrotask(() => source.write(Buffer.from('RFB 003.008\n')));
	return {
		child,
		writes,
		source,
		serverInit,
		get killed() {
			return killed;
		},
	};
}
async function connect(t, options = {}) {
	const tunnels = [],
		activity = [];
	const service = new BotDesktopService({
		engine: async () => ({
			execStream: (_name, command, opts) => {
				assert.deepEqual(command, ['terminay-init', '--tunnel', '5901']);
				assert.equal(opts.user, 'root');
				const f = fakeVnc(options);
				tunnels.push(f);
				return f.child;
			},
		}),
		running: () => true,
		withPassword: async (_id, cb) => cb(Buffer.from('fake-pass')),
		activity: (_id, delta) => activity.push(delta),
	});
	t.after(() => service.close());
	return { service, tunnels, activity };
}
async function clientHandshake(relay) {
	const chunks = [];
	relay.on('data', (c) => chunks.push(c));
	await new Promise((resolve, reject) =>
		relay.write(Buffer.from('RFB 003.008\n'), (e) =>
			e ? reject(e) : resolve(),
		),
	);
	await new Promise((resolve, reject) =>
		relay.write(Buffer.from([1, 1]), (e) => (e ? reject(e) : resolve())),
	);
	return chunks;
}
test('4.11 authenticates only server-side, serves None to client, uses exec, filters inputs and tears down on revocation', async (t) => {
	const f = await connect(t),
		controller = new AbortController();
	const relay = await f.service.open(authority(controller), id, 1);
	const chunks = await clientHandshake(relay);
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(
		Buffer.concat(chunks),
		Buffer.concat([
			Buffer.from('RFB 003.008\n'),
			Buffer.from([1, 1]),
			Buffer.alloc(4),
			f.tunnels[0].serverInit,
		]),
	);
	await new Promise((resolve) =>
		relay.write(Buffer.concat([key, pointer, clipboard, update]), resolve),
	);
	assert.deepEqual(Buffer.concat(f.tunnels[0].writes), update);
	const frame = Buffer.from([0, 0, 0, 0]);
	f.tunnels[0].source.write(frame);
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(chunks.at(-1), frame);
	const closed = once(relay, 'close');
	controller.abort();
	await closed;
	assert.equal(f.tunnels[0].child.stdin.writableEnded, true);
	assert.deepEqual(f.activity, [1, -1]);
	await assert.rejects(f.service.open(authority(), id, 1), /stale/);
});
test('4.11 mode changes replace generation, thumbnail is independent view-only, unknown input closes', async (t) => {
	const f = await connect(t);
	const old = await f.service.open(authority(), id, 1);
	const next = await f.service.open(authority(), id, 2, 'control');
	assert.equal(old.destroyed, true);
	await clientHandshake(next);
	await new Promise((resolve) => next.write(key, resolve));
	assert.deepEqual(Buffer.concat(f.tunnels[1].writes), key);
	const thumb = await f.service.open(authority(), id, 1, 'view-only', true);
	assert.equal(thumb.binding.slot, 'thumbnail');
	await assert.rejects(
		f.service.open(authority(), id, 3, 'control', true),
		/mode/,
	);
	const closed = once(next, 'close');
	next.write(Buffer.from([255]));
	await closed;
	assert.equal(next.destroyed, true);
	f.service.closeConnection('connection');
	assert.equal(thumb.destroyed, true);
});
test('4.11 bad upstream auth and capability-bound clients are refused', async (t) => {
	const f = await connect(t, { badAuth: true });
	await assert.rejects(f.service.open(authority(), id, 1), /connection failed/);
	await assert.rejects(
		f.service.open({ ...authority(), claims: { projectId: 'project' } }, id, 2),
		/authority/,
	);
	assert.equal(f.tunnels.length, 1);
});

test('4.11 duplex backpressure holds writes and pauses frames at the readable bound', async (t) => {
	const { BotRfbRelay } = await import('../dist/botService/index.js');
	let flush;
	const source = new PassThrough(),
		sink = new Writable({
			highWaterMark: 1,
			write(_chunk, _encoding, callback) {
				flush = callback;
			},
		});
	const relay = new BotRfbRelay(
		{
			connectionId: 'connection',
			clientId: 'client',
			botId: id,
			generation: 1,
			mode: 'view-only',
			slot: 'desktop',
		},
		authority(),
		source,
		sink,
		Buffer.alloc(24),
		() => {
			source.destroy();
			sink.destroy();
		},
	);
	t.after(() => relay.destroy());
	await new Promise((resolve) =>
		relay.write(
			Buffer.concat([Buffer.from('RFB 003.008\n'), Buffer.from([1, 1])]),
			resolve,
		),
	);
	for (let i = 0; i < 8; i++) source.write(Buffer.alloc(64 * 1024));
	assert.equal(source.isPaused(), true);
	assert.ok(relay.readableLength < 512 * 1024);
	let acknowledged = false;
	relay.write(update, () => {
		acknowledged = true;
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(acknowledged, false);
	flush();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(acknowledged, true);
});

test('4.11 VNC challenge response matches the independent standard DES vector', () => {
	const password = Buffer.from([
		0xc8, 0x2c, 0xea, 0x9e, 0xd9, 0x3d, 0xfb, 0x8f,
	]);
	const challenge = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
	assert.equal(
		botVncChallengeResponse(password, challenge).toString('hex'),
		'85e813540f0ab40585e813540f0ab405',
	);
});

test('SetEncodings relays only encodings the relay can carry (no fence or continuous updates)', () => {
	const encodings = [7, -312, -313, 0, -224, 1234];
	const message = Buffer.alloc(4 + encodings.length * 4);
	message[0] = 2;
	message.writeUInt16BE(encodings.length, 2);
	for (const [i, e] of encodings.entries()) message.writeInt32BE(e, 4 + i * 4);
	for (const mode of ['control', 'view-only']) {
		const out = new BotRfbClientFilter(mode).push(message);
		assert.equal(out[0], 2);
		const count = out.readUInt16BE(2);
		const kept = Array.from({ length: count }, (_, i) => out.readInt32BE(4 + i * 4));
		assert.deepEqual(kept, [7, 0, -224]);
		assert.equal(out.length, 4 + count * 4);
	}
});
