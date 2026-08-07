import assert from 'node:assert/strict';
import test from 'node:test';
import {
	decodeFrame,
	DEFAULT_PROTOCOL_LIMITS,
	encodeFrame,
} from '@terminay/protocol';
import {
	createServerCore,
	OrderedEventJournal,
	OutboundDeliveryError,
	OutboundDeliveryPump,
} from '../dist/index.js';

test('outbound delivery serializes concurrent sends and completes in FIFO order', async () => {
	const transport = new ControlledTransport();
	await transport.open();
	transport.blockWrites = true;
	const failures = [];
	const pump = new OutboundDeliveryPump(
		transport,
		{ maxQueuedBytes: 32, maxQueuedFrames: 4 },
		(error) => failures.push(error),
	);
	const completed = [];
	const first = pump
		.send(new Uint8Array([1]))
		.then(() => completed.push('first'));
	const second = pump
		.send(new Uint8Array([2]))
		.then(() => completed.push('second'));
	const third = pump
		.send(new Uint8Array([3]))
		.then(() => completed.push('third'));

	await immediate();
	assert.deepEqual(transport.sent, []);
	transport.releaseWrites();
	await Promise.all([first, second, third]);
	assert.deepEqual(
		transport.sent.map((frame) => [...frame]),
		[[1], [2], [3]],
	);
	assert.deepEqual(completed, ['first', 'second', 'third']);
	assert.equal(transport.maxConcurrentSends, 1);
	assert.deepEqual(failures, []);
});

test('outbound delivery fails atomically with one typed reason', async () => {
	const transport = new ControlledTransport();
	await transport.open();
	transport.blockWrites = true;
	const failures = [];
	const pump = new OutboundDeliveryPump(
		transport,
		{ maxQueuedBytes: 2, maxQueuedFrames: 2 },
		(error, snapshot) => failures.push({ error, snapshot }),
	);
	const first = pump.send(new Uint8Array([1]));
	const second = pump.send(new Uint8Array([2]));
	void first.catch(() => undefined);
	void second.catch(() => undefined);
	const overflow = pump.send(new Uint8Array([3]));
	void overflow.catch(() => undefined);
	const results = await Promise.allSettled([first, second, overflow]);
	assert.equal(failures.length, 1);
	assert.deepEqual(failures[0].snapshot, { queuedBytes: 2, queuedFrames: 2 });
	assert.ok(failures[0].error instanceof OutboundDeliveryError);
	for (const result of results) {
		assert.equal(result.status, 'rejected');
		assert.equal(result.reason, failures[0].error);
	}
	await assert.rejects(
		pump.send(new Uint8Array([4])),
		(error) => error === failures[0].error,
	);
});

test('live event send rejection closes one server connection without an unhandled rejection', async () => {
	const journal = new OrderedEventJournal();
	const transport = new ControlledTransport(
		(frame) => decodeFrame(frame).envelope.type === 'event',
	);
	const diagnostics = [];
	let closed = 0;
	const core = createServerCore({
		serverId: 'delivery-server',
		serverVersion: 'test',
		capabilities: [],
		eventJournal: journal,
		authenticate: ({ hello }) => ({
			clientId: hello.clientId,
			authScope: 'read',
		}),
	});
	const connection = core.accept(transport, {
		onClosed: () => {
			closed += 1;
		},
		onDeliveryDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
	});
	const unhandled = [];
	const onUnhandled = (reason) => unhandled.push(reason);
	process.on('unhandledRejection', onUnhandled);
	const run = connection.start();
	try {
		transport.push(
			encodeFrame({
				type: 'client_hello',
				protocolMin: 1,
				protocolMax: 1,
				clientId: 'delivery-client',
				clientVersion: 'test',
				capabilities: ['events.resync'],
				limits: {},
			}),
		);
		await waitFor(() => connection.state === 'open');
		transport.push(
			encodeFrame({
				type: 'command',
				commandId: 'subscribe',
				correlationId: 'subscribe-correlation',
				operation: 'events.subscribe',
				payload: {
					subscriptionId: 'events',
					event: 'terminal',
					fromRevision: 0,
				},
			}),
		);
		await waitFor(() =>
			transport.sent.some(
				(frame) => decodeFrame(frame).envelope.type === 'command_result',
			),
		);

		journal.append('terminal', { position: 1 });
		await waitFor(() => connection.state === 'closed');
		await run;
		await immediate();

		assert.equal(transport.closeCount, 1);
		assert.equal(closed, 1);
		assert.deepEqual(unhandled, []);
		assert.deepEqual(
			diagnostics.map(({ phase, code }) => ({ phase, code })),
			[
				{ phase: 'failure', code: 'unavailable' },
				{ phase: 'closed', code: 'unavailable' },
			],
		);
		assert.equal(journal.revision, 1);
	} finally {
		process.off('unhandledRejection', onUnhandled);
		await connection.close().catch(() => undefined);
		transport.end();
	}
});

test('characterizes a terminal burst exhausting and permanently closing the shared application connection', async () => {
	const journal = new OrderedEventJournal();
	const transport = new ControlledTransport();
	const diagnostics = [];
	const core = createServerCore({
		serverId: 'terminal-burst-server',
		serverVersion: 'test',
		capabilities: [],
		eventJournal: journal,
		limits: { ...DEFAULT_PROTOCOL_LIMITS, maxQueuedBytes: 4 * 1024 },
		authenticate: ({ hello }) => ({
			clientId: hello.clientId,
			authScope: 'write',
		}),
	});
	const connection = core.accept(transport, {
		onDeliveryDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
	});
	const run = connection.start();
	try {
		transport.push(
			encodeFrame({
				type: 'client_hello',
				protocolMin: 1,
				protocolMax: 1,
				clientId: 'terminal-burst-client',
				clientVersion: 'test',
				capabilities: ['events.resync'],
				limits: {},
			}),
		);
		await waitFor(() => connection.state === 'open');
		transport.push(
			encodeFrame({
				type: 'command',
				commandId: 'subscribe-terminal',
				correlationId: 'subscribe-terminal-correlation',
				operation: 'events.subscribe',
				payload: {
					subscriptionId: 'terminal-events',
					event: 'terminal',
					fromRevision: 0,
				},
			}),
		);
		await waitFor(() =>
			transport.sent.some(
				(frame) => decodeFrame(frame).envelope.type === 'command_result',
			),
		);

		// Model a renderer/xterm stall while a PTY emits a finite burst. The
		// production limit is 16 MiB; this proportionally smaller boundary makes
		// the same state transition deterministic without allocating 200 MiB.
		transport.blockWrites = true;
		for (let index = 0; index < 16; index += 1) {
			journal.append('terminal', {
				attachmentId: 'terminal-attachment',
				clientId: 'terminal-burst-client',
				projectId: 'project-a',
				serverId: 'terminal-burst-server',
				sessionId: 'session-a',
				type: 'output',
				position: index * 512,
				nextPosition: (index + 1) * 512,
				bytes: 'eA=='.repeat(192),
			});
		}

		await waitFor(() => connection.state === 'closed');
		await run;
		assert.equal(transport.closeCount, 1);
		assert.deepEqual(
			diagnostics.map(({ phase, code }) => ({ phase, code })),
			[
				{ phase: 'failure', code: 'resource' },
				{ phase: 'closed', code: 'resource' },
			],
		);
		assert.equal(
			diagnostics[0].queuedBytes > 0,
			true,
			'a finite terminal backlog consumes the shared connection queue',
		);
	} finally {
		transport.releaseWrites();
		await connection.close().catch(() => undefined);
		transport.end();
	}
});

class ControlledTransport {
	state = 'opening';
	queuedBytes = 0;
	bufferedBytes = 0;
	sent = [];
	closeCount = 0;
	blockWrites = false;
	maxConcurrentSends = 0;
	#activeSends = 0;
	#incoming = [];
	#waiters = [];
	#writeWaiters = [];
	#listeners = new Set();
	#rejectSend;

	constructor(rejectSend = () => false) {
		this.#rejectSend = rejectSend;
	}

	get incoming() {
		return { [Symbol.asyncIterator]: () => ({ next: () => this.#next() }) };
	}

	async open() {
		this.#setState('open');
	}

	async waitForWritable(_requiredBytes, signal) {
		if (signal?.aborted) throw signal.reason;
		if (this.state !== 'open') throw new Error(`transport is ${this.state}`);
		if (!this.blockWrites) return;
		await new Promise((resolve) => this.#writeWaiters.push(resolve));
		if (this.state !== 'open') throw new Error(`transport is ${this.state}`);
	}

	async send(frame) {
		if (this.state !== 'open') throw new Error(`transport is ${this.state}`);
		this.#activeSends += 1;
		this.maxConcurrentSends = Math.max(
			this.maxConcurrentSends,
			this.#activeSends,
		);
		try {
			if (this.#rejectSend(frame))
				throw new Error('scripted transport rejection');
			this.sent.push(frame.slice());
		} finally {
			this.#activeSends -= 1;
		}
	}

	async close(reason = { code: 'normal' }) {
		if (this.state === 'closed') return;
		this.closeCount += 1;
		this.#setState('closing', reason);
		this.end();
		this.#setState('closed', reason);
	}

	onStateChange(listener) {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	push(frame) {
		const waiter = this.#waiters.shift();
		if (waiter) waiter({ done: false, value: frame });
		else this.#incoming.push(frame);
	}

	end() {
		for (const waiter of this.#waiters.splice(0))
			waiter({ done: true, value: undefined });
	}

	releaseWrites() {
		this.blockWrites = false;
		for (const resolve of this.#writeWaiters.splice(0)) resolve();
	}

	#next() {
		const frame = this.#incoming.shift();
		if (frame) return Promise.resolve({ done: false, value: frame });
		if (this.state === 'closed')
			return Promise.resolve({ done: true, value: undefined });
		return new Promise((resolve) => this.#waiters.push(resolve));
	}

	#setState(state, reason) {
		this.state = state;
		for (const listener of this.#listeners) listener(state, reason);
	}
}

const immediate = () => new Promise((resolve) => setImmediate(resolve));

async function waitFor(predicate, timeoutMs = 1_000) {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error('condition timed out');
		await immediate();
	}
}
