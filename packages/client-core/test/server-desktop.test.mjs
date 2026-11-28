import assert from 'node:assert/strict';
import test from 'node:test';
import {
	ServerDesktopClient,
	serverDesktopRefusal,
	serverOffersDesktop,
} from '../dist/index.js';

/** One server's desktop, as a feature client reaches it. */
function fakeServer() {
	const listeners = new Map();
	const server = {
		calls: [],
		status: { state: 'ready', display: 765 },
		controller: null,
		streams: 0,
		chunks: [],
		refuse: undefined,
		emit(event, payload) {
			for (const listener of listeners.get(event) ?? []) listener({ event, payload });
		},
		transport: {
			query: async (operation, payload) => {
				server.calls.push(['query', operation, payload]);
				return { status: server.status, controller: server.controller };
			},
			command: async (operation, payload) => {
				server.calls.push(['command', operation, payload]);
				if (server.refuse) throw server.refuse;
				if (/open|control/.test(operation)) {
					server.streams += 1;
					return {
						handle: { streamId: `s${server.streams}`, generation: payload.generation },
						mode: operation.endsWith('.open') && server.controller ? 'view-only' : operation.endsWith('release-control') ? 'view-only' : 'control',
						controller: server.controller,
					};
				}
				if (operation.endsWith('.close')) return null;
				return { status: server.status };
			},
			commandWithBody: async (operation, payload, body) => {
				server.calls.push(['write', operation, payload, Buffer.from(body).toString()]);
				return null;
			},
			queryWithBody: async (operation, payload) => {
				server.calls.push(['read', operation, payload]);
				const next = server.chunks.shift();
				return next === undefined
					? { result: { done: true }, body: new Uint8Array() }
					: { result: { done: false }, body: next };
			},
			subscribe: (event, listener) => {
				if (!listeners.has(event)) listeners.set(event, new Set());
				listeners.get(event).add(listener);
				return () => listeners.get(event).delete(listener);
			},
		},
	};
	return server;
}

test('a server offers a desktop only when its hello says so', () => {
	assert.equal(serverOffersDesktop(['terminal.v1', 'server-desktop.v1']), true);
	assert.equal(serverOffersDesktop(['terminal.v1', 'bots.v1']), false);
	assert.equal(serverOffersDesktop([]), false);
});

test('status, setup, enable and disable send nothing a server would have to trust', async () => {
	const server = fakeServer();
	const client = new ServerDesktopClient(server.transport);
	assert.deepEqual(await client.status(), { status: { state: 'ready', display: 765 }, controller: null });
	await client.setup();
	await client.enable();
	await client.disable();
	await client.disable(true);
	assert.deepEqual(server.calls, [
		['query', 'server.desktop.status', {}],
		['command', 'server.desktop.setup', {}],
		['command', 'server.desktop.enable', {}],
		['command', 'server.desktop.disable', {}],
		['command', 'server.desktop.disable', { confirmed: true }],
	]);
});

test('a malformed status is refused, not shown', async () => {
	const server = fakeServer();
	server.status = { state: 'ready', display: 'seven' };
	await assert.rejects(new ServerDesktopClient(server.transport).status(), /invalid server desktop status/);
	server.status = { state: 'made-up' };
	await assert.rejects(new ServerDesktopClient(server.transport).status(), /invalid server desktop status/);
});

test('each stream request carries a newer generation and never a mode; the server decides the mode', async () => {
	const server = fakeServer();
	const client = new ServerDesktopClient(server.transport);
	const first = await client.open();
	assert.equal(first.mode, 'control');
	server.controller = { clientId: 'other', deviceName: 'Laptop' };
	const second = await client.open();
	assert.equal(second.mode, 'view-only');
	assert.deepEqual(second.controller, { clientId: 'other', deviceName: 'Laptop' });
	const third = await client.takeControl();
	assert.equal(third.mode, 'control');
	const fourth = await client.releaseControl();
	assert.equal(fourth.mode, 'view-only');
	assert.deepEqual(
		server.calls.map(([, operation, payload]) => [operation, payload]),
		[
			['server.desktop.open', { generation: 1 }],
			['server.desktop.open', { generation: 2 }],
			['server.desktop.take-control', { generation: 3 }],
			['server.desktop.release-control', { generation: 4 }],
		],
	);
});

test('a stream reads and writes under its own handle and closes once', async () => {
	const server = fakeServer();
	const client = new ServerDesktopClient(server.transport);
	const stream = await client.open();
	server.calls.length = 0;
	server.chunks.push(Buffer.from('one'), Buffer.from('two'));
	const read = [];
	for await (const chunk of stream.read()) read.push(Buffer.from(chunk).toString());
	assert.deepEqual(read, ['one', 'two']);
	const handle = { streamId: 's1', generation: 1 };
	assert.deepEqual(server.calls.slice(0, 3), [
		['read', 'server.desktop.read', handle],
		['read', 'server.desktop.read', handle],
		['read', 'server.desktop.read', handle],
	]);
	const other = await client.open();
	await other.write(Buffer.from('keys'));
	assert.deepEqual(server.calls.at(-1), ['write', 'server.desktop.write', { streamId: 's2', generation: 2 }, 'keys']);
	await other.close();
	await other.close();
	assert.equal(server.calls.filter(([, operation]) => operation === 'server.desktop.close').length, 1);
	await assert.rejects(other.write(Buffer.from('late')), /desktop stream closed/);
});

test('watch follows status and controller, ignores what it cannot read, and stops when asked', async () => {
	const server = fakeServer();
	const client = new ServerDesktopClient(server.transport);
	const seen = [];
	const stop = await client.watch({
		status: (status) => seen.push(['status', status.state]),
		controller: (controller) => seen.push(['controller', controller?.deviceName ?? null]),
	});
	server.emit('server.desktop.changed', { status: { state: 'off' } });
	server.emit('server.desktop.changed', { status: { state: 'nonsense' } });
	server.emit('server.desktop.control', { controller: { clientId: 'c', deviceName: 'Phone' } });
	server.emit('server.desktop.control', { controller: null });
	server.emit('server.desktop.control', { controller: { clientId: 7 } });
	stop();
	server.emit('server.desktop.changed', { status: { state: 'ready', display: 765 } });
	assert.deepEqual(seen, [
		['status', 'off'],
		['controller', 'Phone'],
		['controller', null],
	]);
});

test('a refusal carries its reason, and the open-window count when turning off', async () => {
	const error = Object.assign(new Error('conflict'), { details: { reason: 'windows-open', windows: 3 } });
	assert.deepEqual(serverDesktopRefusal(error), { reason: 'windows-open', windows: 3 });
	// As a feature client wraps it.
	const wrapped = Object.assign(new Error('conflict'), { cause: Object.assign(new Error('x'), { details: { reason: 'setup-by-command' } }) });
	assert.deepEqual(serverDesktopRefusal(wrapped), { reason: 'setup-by-command' });
	assert.equal(serverDesktopRefusal(new Error('network')), undefined);
});
