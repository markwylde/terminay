import assert from 'node:assert/strict';
import test from 'node:test';
import { TerminayClient } from '@terminay/client-core';
import { createInMemoryTransportPair } from '@terminay/protocol-conformance';
import { HeadlessChannelTransport, ServerConnection } from '../dist/index.js';

class FakeChannel {
	constructor(peer = null) {
		this.label = 'application';
		this.peer = peer;
		this.readyState = 'open';
		this.bufferedAmount = 0;
		this.messages = new Set();
		this.states = new Set();
		this.closed = false;
	}

	send(frame) {
		if (this.readyState !== 'open') throw new Error('channel is not open');
		const copy = new Uint8Array(frame);
		this.peer?.emit(copy);
	}

	close() {
		if (this.closed) return;
		this.closed = true;
		this.readyState = 'closed';
		for (const listener of [...this.states]) listener('closed');
		if (this.peer !== null && !this.peer.closed) this.peer.close();
	}

	onMessage(listener) {
		this.messages.add(listener);
		return () => this.messages.delete(listener);
	}

	onStateChange(listener) {
		this.states.add(listener);
		return () => this.states.delete(listener);
	}

	emit(frame) {
		for (const listener of [...this.messages]) listener(new Uint8Array(frame));
	}
}

function deferred() {
	let resolve;
	const promise = new Promise((nextResolve) => {
		resolve = nextResolve;
	});
	return { promise, resolve };
}

async function createTransportPair(kind) {
	if (kind === 'local') {
		const pair = createInMemoryTransportPair();
		await pair.open();
		return { client: pair.client, server: pair.server };
	}

	const clientChannel = new FakeChannel();
	const serverChannel = new FakeChannel(clientChannel);
	clientChannel.peer = serverChannel;
	return {
		client: new HeadlessChannelTransport(clientChannel),
		server: new HeadlessChannelTransport(serverChannel),
	};
}

async function withConnection(kind, callback) {
	const transports = await createTransportPair(kind);
	const cancelStarted = deferred();
	const cancelRelease = deferred();
	const state = {
		cancelStarted,
		cancelRelease,
		serverAborted: false,
		body: undefined,
	};
	const server = new ServerConnection(transports.server, {
		serverId: 'server-conformance',
		serverVersion: 'test',
		capabilities: ['conformance'],
		authenticate: ({ hello }) => ({
			clientId: hello.clientId,
			authScope: 'write',
		}),
		queries: {
			'conformance.query': ({ envelope, context }) => ({
				clientId: context.clientId,
				payload: envelope.payload,
			}),
		},
		commands: {
			'conformance.command': ({ envelope, context }) => ({
				result: { clientId: context.clientId, payload: envelope.payload },
				revision: (envelope.expectedRevision ?? 0) + 1,
			}),
			'conformance.binary': ({ body, context }) => {
				state.body = body.slice();
				return {
					bytes: [...body],
					byteLength: body.byteLength,
					clientId: context.clientId,
				};
			},
			'conformance.cancel': ({ context }) => {
				state.cancelStarted.resolve();
				const onAbort = () => {
					state.serverAborted = true;
				};
				if (context.signal.aborted) onAbort();
				else context.signal.addEventListener('abort', onAbort, { once: true });
				return cancelRelease.promise.then(() => ({ cancelled: true }));
			},
		},
	});
	const serverTask = server.start();
	const client = new TerminayClient({
		transport: transports.client,
		clientId: 'client-conformance',
		capabilities: ['conformance'],
	});

	try {
		await client.connect();
		return await callback({ client, state });
	} finally {
		cancelRelease.resolve();
		await client.close().catch(() => undefined);
		await serverTask.catch(() => undefined);
	}
}

async function runQueryCommandBinary(kind) {
	return withConnection(kind, async ({ client, state }) => {
		const query = await client.query('conformance.query', {
			operation: 'query',
		});
		const command = await client.command(
			'conformance.command',
			{ operation: 'command' },
			{ commandId: `command-${kind}`, expectedRevision: 4 },
		);
		const body = new Uint8Array([0, 1, 2, 127, 255]);
		const binary = await client.commandWithBody(
			'conformance.binary',
			{ contentType: 'application/octet-stream' },
			body,
			{ commandId: `binary-${kind}` },
		);

		assert.deepEqual(query.result, {
			clientId: 'client-conformance',
			payload: { operation: 'query' },
		});
		assert.deepEqual(command.result, {
			clientId: 'client-conformance',
			payload: { operation: 'command' },
		});
		assert.equal(command.revision, 5);
		assert.deepEqual(binary.result, {
			bytes: [0, 1, 2, 127, 255],
			byteLength: 5,
			clientId: 'client-conformance',
		});
		assert.deepEqual([...state.body], [...body]);

		return {
			query: query.result,
			command: command.result,
			binary: binary.result,
		};
	});
}

for (const kind of ['local', 'remote']) {
	test(`${kind} and headless transports preserve query, command, and binary-body results`, async () => {
		const result = await runQueryCommandBinary(kind);
		assert.deepEqual(result.query.payload, { operation: 'query' });
		assert.deepEqual(result.command.payload, { operation: 'command' });
		assert.deepEqual(result.binary.bytes, [0, 1, 2, 127, 255]);
	});
}

for (const kind of ['local', 'remote']) {
	test(`${kind} transport propagates per-request cancellation to the server handler`, async () => {
		await withConnection(kind, async ({ client, state }) => {
			const controller = new AbortController();
			const pending = client.command(
				'conformance.cancel',
				{ operation: 'cancel' },
				{ commandId: `cancel-${kind}`, signal: controller.signal },
			);
			await state.cancelStarted.promise;
			controller.abort(new Error('test cancellation'));
			await assert.rejects(
				pending,
				(error) =>
					error instanceof Error && error.message === 'test cancellation',
			);
			await new Promise((resolve) => setImmediate(resolve));
			assert.equal(
				state.serverAborted,
				true,
				'the server handler must observe request cancellation',
			);
		});
	});
}
