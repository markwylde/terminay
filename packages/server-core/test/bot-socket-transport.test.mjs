import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import test from 'node:test';
import {
	BotEngine,
	BotEngineService,
	demultiplex,
	EngineProcess,
	SocketTransport,
} from '../dist/botService/index.js';
import { startBotSocketServer } from './fixtures/bot-socket-server.mjs';

function frame(bytes, channel = 1) {
	const h = Buffer.alloc(8);
	h[0] = channel;
	h.writeUInt32BE(bytes.length, 4);
	return Buffer.concat([h, bytes]);
}
test('non-TTY demultiplexing preserves arbitrary binary bytes across every header/payload split', async () => {
	const out = Buffer.from([0, 255, 1, 128, 10]),
		err = Buffer.from('stderr🔐');
	const bytes = Buffer.concat([
		frame(out),
		frame(err, 2),
		frame(Buffer.from('last')),
	]);
	for (let split = 0; split <= bytes.length; split++) {
		const stdout = new PassThrough(),
			stderr = new PassThrough(),
			o = [],
			e = [];
		stdout.on('data', (c) => o.push(c));
		stderr.on('data', (c) => e.push(c));
		await demultiplex(
			Readable.from([bytes.subarray(0, split), bytes.subarray(split)]),
			stdout,
			stderr,
		);
		assert.deepEqual(
			Buffer.concat(o),
			Buffer.concat([out, Buffer.from('last')]),
		);
		assert.deepEqual(Buffer.concat(e), err);
	}
});
test('malformed, oversized and incomplete frames fail; TTY bytes remain raw', async () => {
	const bad = Buffer.alloc(8);
	bad[0] = 1;
	bad.writeUInt32BE(17 * 1024 * 1024, 4);
	await assert.rejects(
		demultiplex(Readable.from([bad]), new PassThrough(), new PassThrough()),
		{ code: 'output-limit' },
	);
	await assert.rejects(
		demultiplex(
			Readable.from([frame(Buffer.from('ok')).subarray(0, 9)]),
			new PassThrough(),
			new PassThrough(),
		),
		/incomplete/,
	);
	const stdout = new PassThrough(),
		chunks = [];
	stdout.on('data', (c) => chunks.push(c));
	await demultiplex(
		Readable.from([Buffer.from([255, 0, 1])]),
		stdout,
		new PassThrough(),
		true,
	);
	assert.deepEqual(Buffer.concat(chunks), Buffer.from([255, 0, 1]));
});
async function transportFixture(t, handler) {
	const root = await mkdtemp(path.join(tmpdir(), 'api-wire-')),
		socket = path.join(root, 's.sock');
	const connections = new Set();
	const server = createServer(handler);
	server.on('connection', (s) => {
		connections.add(s);
		s.once('close', () => connections.delete(s));
	});
	await new Promise((r) => server.listen(socket, r));
	t.after(async () => {
		for (const s of connections) s.destroy();
		await new Promise((r) => server.close(r));
		await rm(root, { recursive: true, force: true });
	});
	return new SocketTransport(socket);
}
test('finite requests have absolute response deadlines, byte limits and safe status errors', async (t) => {
	const transport = await transportFixture(t, (req, res) => {
		if (req.url === '/slow') {
			res.writeHead(200);
			res.write('{');
			return;
		}
		if (req.url === '/big') {
			res.end(JSON.stringify('x'.repeat(1024)));
			return;
		}
		res.writeHead(Number(req.url.slice(1)));
		res.end(JSON.stringify({ message: 'secret-daemon-diagnostic' }));
	});
	await assert.rejects(
		transport.json('GET', '/slow', undefined, { deadlineMs: 50 }),
		(e) => e.code === 'deadline' || e.code === 'ECONNRESET',
	);
	await assert.rejects(
		transport.json('GET', '/big', undefined, { maxBytes: 32 }),
		{ code: 'output-limit' },
	);
	for (const [status, code] of [
		[404, 'not-found'],
		[403, 'permission-denied'],
		[500, 'not-running'],
	])
		await assert.rejects(
			transport.json('GET', `/${status}`),
			(e) => e.code === code && !e.message.includes('secret'),
		);
});
test('abort tears down an in-progress finite request', async (t) => {
	const transport = await transportFixture(t, (_req, res) => {
		res.writeHead(200);
		res.write('{');
	});
	const controller = new AbortController();
	const pending = transport.json('GET', '/abort', undefined, {
		signal: controller.signal,
	});
	controller.abort();
	await assert.rejects(pending);
});
test('version negotiation accepts common API and refuses unsupported API floors', async (t) => {
	let version = { ApiVersion: '1.48', MinAPIVersion: '1.44' };
	const transport = await transportFixture(t, (_req, res) =>
		res.end(JSON.stringify(version)),
	);
	await transport.negotiate();
	assert.equal(transport.version, '1.48');
	version = { ApiVersion: '1.60', MinAPIVersion: '1.59' };
	await assert.rejects(transport.negotiate(), {
		code: 'unsupported-engine-mode',
	});
});
test('Podman missing-image status is buildable and image errors do not discard engine status', async (t) => {
	const root = await mkdtemp(path.join(tmpdir(), 'image-status-'));
	const api = await startBotSocketServer(root, {
		kind: 'podman',
		randomID: true,
	});
	let pin;
	const store = {
		load: async () => pin,
		save: async (p) => {
			pin = p;
		},
	};
	const engine = new BotEngine(
		store,
		new EngineProcess({
			DOCKER_HOST: `unix://${api.socketPath}`,
			HOME: root,
			PATH: '/empty',
		}),
	);
	const service = new BotEngineService(
		engine,
		store,
		new URL('../../../docker/terminay-bot', import.meta.url).pathname,
		() => [],
		'server',
	);
	t.after(async () => {
		await service.close();
		await api.close();
		await rm(root, { recursive: true, force: true });
	});
	let events = 0;
	service.on('changed', () => events++);
	for (let i = 0; i < 3; i++) {
		const status = await service.status();
		assert.equal(status.engine, 'podman');
		assert.equal(status.available, true);
		assert.equal(status.image.state, 'missing');
	}
	assert.equal(events, 0);
	const originalDiscovery = engine.discover.bind(engine);
	engine.discover = async () =>
		(await originalDiscovery()).map((c) =>
			c.available
				? {
						...c,
						details: {
							...c.details,
							pin: {
								...c.details.pin,
								address: 'unix:///another-alias-of-the-same-engine.sock',
							},
						},
					}
				: c,
		);
	const aliases = await service.status();
	assert.equal(
		aliases.candidates.filter((c) => c.available).length,
		0,
		'an alias of the current engine is not offered as a different engine',
	);
	api.config.imageError = true;
	const status = await service.status();
	assert.equal(status.engine, 'podman');
	assert.equal(status.available, true);
	assert.equal(status.image.state, 'failed');
	assert.ok(status.image.error);
	api.config.imageError = false;
	const recovered = await service.status();
	assert.equal(recovered.image.state, 'missing');
	assert.equal(recovered.image.error, null);
});

test('closing a transport aborts its live event stream', async (t) => {
	const transport = await transportFixture(t, (_req, res) => {
		res.writeHead(200);
		res.flushHeaders();
	});
	const stream = await transport.subscribe(
		'GET',
		'/events',
		undefined,
		new AbortController().signal,
	);
	const closed = new Promise((resolve) => stream.once('close', resolve));
	transport.close();
	await closed;
});
