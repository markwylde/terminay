import assert from 'node:assert/strict';
import test from 'node:test';
import { TerminayClient } from '@terminay/client-core';
import { encodeFrame } from '@terminay/protocol';
import { createInMemoryTransportPair } from '@terminay/protocol-conformance';
import { createOperationDispatcher, createServerCore } from '../dist/index.js';

const deferred = () => {
	let resolve;
	const promise = new Promise((next) => {
		resolve = next;
	});
	return { promise, resolve };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
const settled = (promise) =>
	promise.then(
		(value) => ({ value }),
		(error) => ({ error }),
	);
async function until(check) {
	for (let i = 0; i < 1000 && !check(); i++) await tick();
	assert.ok(check());
}

async function connected(t, options = {}, clientOptions = {}) {
	const pair = createInMemoryTransportPair();
	const connection = createServerCore({
		serverId: 'admission',
		serverVersion: 'test',
		capabilities: [],
		authenticate: ({ hello }) => ({
			clientId: hello.clientId,
			authScope: 'write',
		}),
		...options,
	}).accept(pair.server);
	const serverTask = connection.start();
	const client = new TerminayClient({
		transport: pair.client,
		clientId: 'admission-client',
		...clientOptions,
	});
	t.after(async () => {
		await client.close();
		await serverTask;
	});
	await pair.open();
	await client.connect();
	return { client, connection, pair, serverTask };
}

test('concurrent duplicate commands execute once and each response retains its own correlation', async () => {
	const gate = deferred();
	let calls = 0;
	const dispatcher = createOperationDispatcher({
		commands: {
			'review.mutate': async () => {
				calls++;
				await gate.promise;
				return { result: { committed: true } };
			},
		},
	});
	const request = (
		correlationId,
		payload = { text: 'same' },
		body = new Uint8Array(),
	) => ({
		envelope: {
			type: 'command',
			commandId: 'immutable-command',
			correlationId,
			operation: 'review.mutate',
			payload,
		},
		body,
		context: {
			connectionId: 'connection',
			clientId: 'client',
			authScope: 'write',
			signal: new AbortController().signal,
		},
	});
	const first = dispatcher.commandWithOutcome(request('first'));
	const second = dispatcher.commandWithOutcome(request('second'));
	assert.equal(calls, 1);
	const changed = await dispatcher.command(
		request('changed', { text: 'different' }),
	);
	assert.equal(changed.error.code, 'conflict');
	const changedBody = await dispatcher.command(
		request('changed-body', { text: 'same' }, Uint8Array.of(1)),
	);
	assert.equal(changedBody.error.code, 'conflict');
	gate.resolve();
	const results = await Promise.all([first, second]);
	assert.deepEqual(
		results.map((result) => result.envelope.correlationId),
		['first', 'second'],
	);
	assert.deepEqual(
		results.map((result) => result.executed),
		[true, false],
	);
	const replay = await dispatcher.commandWithOutcome(request('third'));
	assert.equal(replay.envelope.correlationId, 'third');
	assert.equal(replay.executed, false);
	assert.equal(calls, 1);
});

test('cancelling a duplicate waiter leaves the original command running', async () => {
	const gate = deferred();
	const controller = new AbortController();
	let calls = 0;
	const dispatcher = createOperationDispatcher({
		commands: {
			'review.mutate': async () => {
				calls++;
				await gate.promise;
				return null;
			},
		},
	});
	const request = (signal) => ({
		envelope: {
			type: 'command',
			commandId: 'same',
			correlationId: 'correlation',
			operation: 'review.mutate',
			payload: {},
		},
		body: new Uint8Array(),
		context: {
			connectionId: 'connection',
			clientId: 'client',
			authScope: 'write',
			signal,
		},
	});
	const first = dispatcher.command(request(new AbortController().signal));
	const duplicate = dispatcher.command(request(controller.signal));
	controller.abort();
	assert.equal((await duplicate).error.code, 'cancelled');
	assert.equal(calls, 1);
	gate.resolve();
	assert.equal((await first).ok, true);
});

test('unexpected registry failures settle the ledger and do not exhaust pending-command capacity', async () => {
	const commands = new Map([['review.mutate', () => null]]);
	const lookup = commands.get.bind(commands);
	commands.get = () => {
		throw new Error('registry failed');
	};
	const dispatcher = createOperationDispatcher({ commands });
	const request = (commandId) => ({
		envelope: {
			type: 'command',
			commandId,
			correlationId: commandId,
			operation: 'review.mutate',
			payload: {},
		},
		body: new Uint8Array(),
		context: {
			connectionId: 'connection',
			clientId: 'client',
			authScope: 'write',
			signal: new AbortController().signal,
		},
	});
	for (let i = 0; i < 65; i++)
		assert.equal(
			(await dispatcher.command(request(`failure-${i}`))).error.code,
			'internal',
		);
	commands.get = lookup;
	assert.equal((await dispatcher.command(request('healthy'))).ok, true);
	assert.equal(
		(await dispatcher.command(request('failure-0'))).error.code,
		'internal',
	);
});

test('replayed and conflicting terminal acknowledgements cannot reapply delivery credit', async (t) => {
	let calls = 0;
	const { client, connection } = await connected(t, {
		commands: {
			'terminal.ack': () => {
				calls++;
				return {};
			},
		},
	});
	const acknowledgements = [];
	connection.outbound.acknowledgeTerminal = (attachmentId, position) =>
		acknowledgements.push({ attachmentId, position });
	const options = { commandId: 'ack-once' };
	await client.command(
		'terminal.ack',
		{ attachmentId: 'attachment', position: 10 },
		options,
	);
	const replay = await client.command(
		'terminal.ack',
		{ attachmentId: 'attachment', position: 10 },
		options,
	);
	assert.equal(replay.ok, true);
	await assert.rejects(
		client.command(
			'terminal.ack',
			{ attachmentId: 'attachment', position: 1000 },
			options,
		),
		(error) => error.code === 'conflict',
	);
	assert.equal(calls, 1);
	assert.deepEqual(acknowledgements, [
		{ attachmentId: 'attachment', position: 10 },
	]);
});

test('saturation keeps heartbeat and active/queued cancellation responsive with FIFO feature order', async (t) => {
	const gate = deferred();
	let started = 0;
	let aborted = 0;
	const order = [];
	const { client, connection } = await connected(t, {
		queries: {
			'review.hold': async (request) => {
				started++;
				request.context.signal.addEventListener('abort', () => {
					aborted++;
				});
				await gate.promise;
				return null;
			},
			'review.quick': (request) => {
				order.push(request.envelope.payload.id);
				return null;
			},
		},
	});
	const firstController = new AbortController();
	const pending = Array.from({ length: 64 }, (_, index) =>
		settled(
			client.query(
				'review.hold',
				{},
				index === 0 ? { signal: firstController.signal } : {},
			),
		),
	);
	try {
		await until(() => started === 64);
		const queuedController = new AbortController();
		const cancelled = settled(
			client.query(
				'review.quick',
				{ id: 'cancelled' },
				{ signal: queuedController.signal },
			),
		);
		const one = client.query('review.quick', { id: 'one' });
		const two = client.query('review.quick', { id: 'two' });
		await until(() => connection.pendingFeatures.length === 3);
		const ping = await client.query(
			'connection.ping',
			{ sentAt: 123 },
			{ signal: AbortSignal.timeout(1000) },
		);
		assert.equal(ping.result.sentAt, 123);
		assert.deepEqual(order, []);
		queuedController.abort();
		await cancelled;
		await until(() => connection.pendingFeatures.length === 2);
		firstController.abort();
		await pending[0];
		await one;
		await two;
		assert.equal(aborted, 1);
		assert.deepEqual(order, ['one', 'two']);
		assert.equal(connection.pendingFeatureBytes, 0);
	} finally {
		gate.resolve();
		await Promise.all(pending);
	}
});

test('queued deadlines expire without invoking a handler or waiting for a feature slot', async (t) => {
	const gate = deferred();
	let started = 0;
	let quick = 0;
	const { client } = await connected(t, {
		queries: {
			'review.hold': async () => {
				started++;
				await gate.promise;
				return null;
			},
			'review.quick': () => {
				quick++;
				return null;
			},
		},
	});
	const pending = Array.from({ length: 64 }, () =>
		settled(client.query('review.hold')),
	);
	try {
		await until(() => started === 64);
		await assert.rejects(
			client.query(
				'review.quick',
				{},
				{ deadlineMs: 10, signal: AbortSignal.timeout(1000) },
			),
			(error) => error.code === 'deadline',
		);
		assert.equal(quick, 0);
	} finally {
		gate.resolve();
		await Promise.all(pending);
	}
});

test('time spent queued is deducted from the admitted handler deadline', async (t) => {
	const gate = deferred();
	let started = 0;
	let deadline;
	const { client, connection } = await connected(t, {
		queries: {
			'review.hold': async () => {
				started++;
				await gate.promise;
				return null;
			},
			'review.quick': (request) => {
				deadline = request.context.deadline;
				return null;
			},
		},
	});
	const pending = Array.from({ length: 64 }, () =>
		settled(client.query('review.hold')),
	);
	const originalNow = Date.now;
	try {
		await until(() => started === 64);
		let now = 10000;
		Date.now = () => now;
		const queued = client.query('review.quick', {}, { deadlineMs: 1000 });
		await until(() => connection.pendingFeatures.length === 1);
		now += 400;
		gate.resolve();
		await queued;
		assert.equal(deadline, 11000);
	} finally {
		Date.now = originalNow;
		gate.resolve();
		await Promise.all(pending);
	}
});

test('a saturated connection re-arms the server heartbeat when control frames arrive', async (t) => {
	let now = 0;
	const timers = new Set();
	const gate = deferred();
	let started = 0;
	const advance = (ms) => {
		now += ms;
		for (const timer of [...timers])
			if (timer.at <= now) {
				timers.delete(timer);
				timer.run();
			}
	};
	const { client, connection, serverTask } = await connected(
		t,
		{
			heartbeatNow: () => now,
			heartbeatTimers: {
				setTimeout(run, ms) {
					const timer = { at: now + ms, run };
					timers.add(timer);
					return timer;
				},
				clearTimeout(timer) {
					timers.delete(timer);
				},
			},
			queries: {
				'review.hold': async () => {
					started++;
					await gate.promise;
					return null;
				},
			},
		},
		{ capabilities: ['connection.heartbeat'] },
	);
	const pending = Array.from({ length: 64 }, () =>
		settled(client.query('review.hold')),
	);
	try {
		await until(() => started === 64);
		advance(59000);
		await client.query('connection.ping');
		advance(59000);
		await tick();
		assert.equal(connection.state, 'open');
		advance(2000);
		await serverTask;
		assert.equal(connection.state, 'closed');
	} finally {
		gate.resolve();
		await Promise.all(pending);
	}
});

test('transport end releases a saturated connection and its queued feature frames', async (t) => {
	const gate = deferred();
	let started = 0;
	const { client, connection, pair, serverTask } = await connected(t, {
		queries: {
			'review.hold': async () => {
				started++;
				await gate.promise;
				return null;
			},
		},
	});
	const pending = Array.from({ length: 64 }, () =>
		settled(client.query('review.hold')),
	);
	try {
		await until(() => started === 64);
		pending.push(settled(client.query('review.hold')));
		await until(() => connection.pendingFeatures.length === 1);
		await pair.client.close();
		await serverTask;
		await Promise.all(pending);
		assert.equal(connection.pendingFeatureBytes, 0);
		assert.equal(connection.activeFeatures, 0);
		assert.equal(started, 64);
	} finally {
		gate.resolve();
	}
});

for (const ceiling of ['frames', 'bytes']) {
	test(`pending feature ${ceiling} ceiling closes the connection and releases all pending work`, async (t) => {
		const gate = deferred();
		let started = 0;
		const { connection, pair, serverTask } = await connected(t, {
			...(ceiling === 'bytes' ? { limits: { maxQueuedBytes: 1024 } } : {}),
			queries: {
				'review.hold': async () => {
					started++;
					await gate.promise;
					return null;
				},
			},
		});
		let nextId = 0;
		const raw = (payload) =>
			settled(
				pair.client.send(
					encodeFrame({
						type: 'query',
						queryId: `raw-${nextId++}`,
						operation: 'review.hold',
						payload,
					}),
				),
			);
		const pending = Array.from({ length: 64 }, () => raw({}));
		try {
			await until(() => started === 64);
			const extra = Array.from({ length: ceiling === 'frames' ? 257 : 2 }, () =>
				raw({ padding: ceiling === 'bytes' ? 'x'.repeat(800) : '' }),
			);
			await Promise.all([...pending, ...extra]);
			await serverTask;
			assert.equal(connection.state, 'closed');
			assert.equal(connection.pendingFeatureBytes, 0);
			assert.equal(connection.pendingFeatures.length, 0);
			assert.equal(started, 64);
		} finally {
			gate.resolve();
		}
	});
}

test('a desktop burst larger than the server FIFO waits locally without disconnecting', async (t) => {
	const gate = deferred();
	let started = 0;
	const order = [];
	const { client, connection } = await connected(t, {
		queries: {
			'review.hold': async () => {
				started++;
				await gate.promise;
				return null;
			},
			'review.quick': (request) => {
				order.push(request.envelope.payload.index);
				return null;
			},
		},
	});
	const held = Array.from({ length: 64 }, () =>
		settled(client.query('review.hold')),
	);
	try {
		await until(() => started === 64);
		const burst = Array.from({ length: 600 }, (_, index) =>
			client.query('review.quick', { index }),
		);
		await until(
			() =>
				client.requestAdmission.waiting.length === 536 &&
				connection.pendingFeatures.length === 64,
		);
		await client.query(
			'connection.ping',
			{ sentAt: 1 },
			{ signal: AbortSignal.timeout(1000) },
		);
		assert.equal(connection.state, 'open');
		gate.resolve();
		await Promise.all([...held, ...burst]);
		assert.deepEqual(
			order,
			Array.from({ length: 600 }, (_, index) => index),
		);
		assert.equal(connection.state, 'open');
		assert.equal(client.requestAdmission.waiting.length, 0);
	} finally {
		gate.resolve();
		await Promise.all(held);
	}
});

test('closing a connection rejects a locally queued command as definitively unsent', async (t) => {
	const gate = deferred();
	let started = 0;
	let mutations = 0;
	const { client } = await connected(t, {
		queries: {
			'review.hold': async () => {
				started++;
				await gate.promise;
				return null;
			},
		},
		commands: {
			'review.mutate': () => {
				mutations++;
				return null;
			},
		},
	});
	const pending = Array.from({ length: 128 }, () =>
		settled(client.query('review.hold')),
	);
	try {
		await until(() => started === 64);
		const queued = settled(client.command('review.mutate'));
		await until(() => client.requestAdmission.waiting.length === 1);
		await client.close();
		assert.equal((await queued).error.code, 'unavailable');
		assert.equal(mutations, 0);
		assert.equal(client.requestAdmission.waiting.length, 0);
	} finally {
		gate.resolve();
		await Promise.all(pending);
	}
});

test('locally queued cancellation and deadlines send no command frames', async (t) => {
	const gate = deferred();
	let started = 0;
	let mutations = 0;
	const { client } = await connected(t, {
		queries: {
			'review.hold': async () => {
				started++;
				await gate.promise;
				return null;
			},
		},
		commands: {
			'review.mutate': () => {
				mutations++;
				return null;
			},
		},
	});
	const pending = Array.from({ length: 128 }, () =>
		settled(client.query('review.hold')),
	);
	try {
		await until(() => started === 64);
		const controller = new AbortController();
		const cancelled = settled(
			client.command('review.mutate', {}, { signal: controller.signal }),
		);
		await until(() => client.requestAdmission.waiting.length === 1);
		controller.abort();
		await cancelled;
		await assert.rejects(
			client.command('review.mutate', {}, { deadlineMs: 10 }),
			(error) => error.code === 'deadline',
		);
		assert.equal(client.requestAdmission.waiting.length, 0);
		assert.equal(mutations, 0);
	} finally {
		gate.resolve();
		await Promise.all(pending);
	}
});

test('local admission preserves captured payload/body and deducts its deadline wait', async (t) => {
	const gate = deferred();
	let started = 0;
	let received;
	const { client } = await connected(t, {
		queries: {
			'review.hold': async () => {
				started++;
				await gate.promise;
				return null;
			},
		},
		commands: {
			'review.mutate': (request) => {
				received = request;
				return null;
			},
		},
	});
	const pending = Array.from({ length: 128 }, () =>
		settled(client.query('review.hold')),
	);
	const originalNow = Date.now;
	try {
		await until(() => started === 64);
		let now = 10000;
		Date.now = () => now;
		const payload = { text: 'original' };
		const body = Uint8Array.of(1, 2);
		const queued = client.commandWithBody('review.mutate', payload, body, {
			deadlineMs: 1000,
		});
		await until(() => client.requestAdmission.waiting.length === 1);
		payload.text = 'changed';
		body.fill(3);
		now += 400;
		gate.resolve();
		await queued;
		assert.equal(received.context.deadline, 11000);
		assert.deepEqual(received.envelope.payload, { text: 'original' });
		assert.deepEqual(received.body, Uint8Array.of(1, 2));
	} finally {
		Date.now = originalNow;
		gate.resolve();
		await Promise.all(pending);
	}
});

test('client admission respects the advertised byte budget without disconnecting', async (t) => {
	const gate = deferred();
	let started = 0;
	const { client, connection } = await connected(t, {
		limits: { maxQueuedBytes: 1024 },
		queries: {
			'review.hold': async () => {
				started++;
				await gate.promise;
				return null;
			},
		},
	});
	const pending = [
		settled(client.query('review.hold', { padding: 'x'.repeat(600) })),
		settled(client.query('review.hold', { padding: 'x'.repeat(600) })),
	];
	try {
		await until(
			() => started === 1 && client.requestAdmission.waiting.length === 1,
		);
		assert.ok(client.requestAdmission.outstandingBytes <= 1024);
		assert.ok(client.requestAdmission.waitingBytes <= 1024);
		await client.query('connection.ping');
		assert.equal(connection.state, 'open');
		gate.resolve();
		await Promise.all(pending);
		assert.equal(started, 2);
	} finally {
		gate.resolve();
		await Promise.all(pending);
	}
});
