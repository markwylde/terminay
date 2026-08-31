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

test('latest-value state coalesces under backpressure without consuming control capacity', async () => {
	const transport = new ControlledTransport();
	await transport.open();
	transport.blockWrites = true;
	const failures = [];
	const pump = new OutboundDeliveryPump(transport, { maxQueuedBytes: 8, maxQueuedFrames: 2, maxStateQueuedBytes: 4, maxStateQueuedFrames: 2 }, (error) => failures.push(error));
	const deliveries = [];
	for (let index = 0; index < 2_000; index += 1) {
		deliveries.push(pump.sendState(new Uint8Array([index % 255]), {
			laneId: 'activity-subscription', key: 'session-a', createResyncFrame: () => new Uint8Array([254]),
		}));
	}
	const control = pump.send(new Uint8Array([255]));
	assert.equal(pump.snapshot.queuedFrames <= 3, true);
	assert.deepEqual(failures, []);
	transport.releaseWrites();
	await Promise.all([...deliveries, control]);
	await waitFor(() => pump.snapshot.queuedFrames === 0);
	assert.equal(transport.sent.some((frame) => frame[0] === 255), true);
	assert.deepEqual(failures, []);
});

test('state capacity pressure collapses one subscription to resync without closing the connection', async () => {
	const transport = new ControlledTransport();
	await transport.open();
	transport.blockWrites = true;
	const failures = [];
	const pump = new OutboundDeliveryPump(transport, { maxQueuedBytes: 8, maxQueuedFrames: 2, maxStateQueuedBytes: 3, maxStateQueuedFrames: 2 }, (error) => failures.push(error));
	const deliveries = [];
	for (const key of ['a', 'b', 'c', 'd']) {
		deliveries.push(pump.sendState(new Uint8Array([key.charCodeAt(0)]), {
			laneId: 'activity-subscription', key, createResyncFrame: () => new Uint8Array([200]),
		}));
	}
	const control = pump.send(new Uint8Array([255]));
	transport.releaseWrites();
	await Promise.all([...deliveries, control]);
	await waitFor(() => pump.snapshot.queuedFrames === 0);
	assert.equal(transport.sent.filter((frame) => frame[0] === 200).length, 1);
	assert.equal(transport.sent.filter((frame) => frame[0] === 255).length, 1);
	assert.deepEqual(failures, []);
});

test('terminal congestion supersedes only its lane and preserves control delivery', async () => {
	const transport = new ControlledTransport();
	await transport.open();
	transport.blockWrites = true;
	const failures = [];
	const congestion = [];
	const pump = new OutboundDeliveryPump(
		transport,
		{
			maxQueuedBytes: 32,
			maxQueuedFrames: 8,
			maxTerminalQueuedBytes: 8,
			maxTerminalQueuedFrames: 2,
		},
		(error) => failures.push(error),
		(value) => congestion.push(value),
	);
	const lane = (position, nextPosition) => ({
		laneId: 'attachment-a',
		position,
		nextPosition,
		createResyncFrame: () => new Uint8Array([7]),
	});
	const admitted = [
		pump.sendTerminal(new Uint8Array([1]), lane(0, 1)),
		pump.sendTerminal(new Uint8Array([2]), lane(1, 2)),
		pump.sendTerminal(new Uint8Array([3]), lane(2, 3)),
	];
	const control = pump.send(new Uint8Array([9]));
	const otherLane = pump.sendTerminal(new Uint8Array([5]), {
		laneId: 'attachment-b',
		position: 0,
		nextPosition: 1,
		createResyncFrame: () => new Uint8Array([8]),
	});

	await immediate();
	assert.deepEqual(transport.sent, []);
	assert.deepEqual(congestion, [
		{
			laneId: 'attachment-a',
			queuedBytes: 2,
			queuedFrames: 2,
			confirmedPosition: 0,
			headPosition: 3,
		},
	]);
	assert.equal(pump.snapshot.queuedBytes <= 4, true);

	transport.releaseWrites();
	await Promise.all([...admitted, control, otherLane]);
	await waitFor(() => pump.snapshot.queuedFrames === 0);
	assert.deepEqual(
		transport.sent.map((frame) => [...frame]),
		[[1], [9], [7], [5]],
	);
	assert.deepEqual(failures, []);
});

test('many congested terminal lanes cannot consume reserved control capacity', async () => {
	const transport = new ControlledTransport();
	await transport.open();
	transport.blockWrites = true;
	const failures = [];
	const pump = new OutboundDeliveryPump(
		transport,
		{
			maxQueuedBytes: 128,
			maxQueuedFrames: 4,
			maxTerminalQueuedBytes: 8,
			maxTerminalQueuedFrames: 1,
		},
		(error) => failures.push(error),
	);

	const deliveries = [];
	for (let index = 0; index < 16; index += 1) {
		const laneId = `attachment-${index}`;
		deliveries.push(pump.sendTerminal(new Uint8Array([index]), {
			laneId,
			position: 0,
			nextPosition: 1,
			createResyncFrame: () => new Uint8Array([128 + index]),
		}));
		deliveries.push(pump.sendTerminal(new Uint8Array([index]), {
			laneId,
			position: 1,
			nextPosition: 2,
			createResyncFrame: () => new Uint8Array([128 + index]),
		}));
	}
	const controls = [
		pump.send(new Uint8Array([250])),
		pump.send(new Uint8Array([251])),
		pump.send(new Uint8Array([252])),
		pump.send(new Uint8Array([253])),
	];

	transport.releaseWrites();
	await Promise.all([...deliveries, ...controls]);
	await waitFor(() => pump.snapshot.queuedFrames === 0);
	assert.deepEqual(transport.sent.slice(1, 5).map((frame) => frame[0]), [250, 251, 252, 253]);
	assert.equal(failures.length, 0);
});

test('transport acceptance does not advance the terminal presentation watermark', async () => {
	const transport = new ControlledTransport();
	await transport.open();
	const congestion = [];
	const pump = new OutboundDeliveryPump(
		transport,
		{
			maxQueuedBytes: 32,
			maxTerminalUnconfirmedBytes: 2,
		},
		() => undefined,
		(value) => congestion.push(value),
	);
	const admission = (position, nextPosition) => ({
		laneId: 'attachment-a',
		position,
		nextPosition,
		createResyncFrame: () => new Uint8Array([7]),
	});

	await pump.sendTerminal(new Uint8Array([1]), admission(0, 1));
	await pump.sendTerminal(new Uint8Array([2]), admission(1, 2));
	await pump.sendTerminal(new Uint8Array([3]), admission(2, 3));
	await waitFor(() => transport.sent.length === 3);
	assert.deepEqual(transport.sent.map((frame) => [...frame]), [[1], [2], [7]]);
	assert.equal(congestion.length, 1);
	assert.equal(congestion[0].confirmedPosition, 0);

	pump.releaseTerminal('attachment-a');
	await pump.sendTerminal(new Uint8Array([4]), {
		laneId: 'attachment-b',
		position: 3,
		nextPosition: 4,
		createResyncFrame: () => new Uint8Array([8]),
	});
	assert.deepEqual(transport.sent.at(-1), new Uint8Array([4]));
});

test('an unacknowledged trickle resynchronizes after the presentation age limit', async () => {
	const transport = new ControlledTransport();
	await transport.open();
	let now = 0;
	const congestion = [];
	const pump = new OutboundDeliveryPump(
		transport,
		{
			maxQueuedBytes: 32,
			maxTerminalUnconfirmedBytes: 32,
			maxTerminalUnconfirmedAgeMs: 5,
		},
		() => undefined,
		(value) => congestion.push(value),
		() => now,
	);
	const admission = (position, nextPosition) => ({
		laneId: 'attachment-aged',
		position,
		nextPosition,
		createResyncFrame: () => new Uint8Array([7]),
	});

	await pump.sendTerminal(new Uint8Array([1]), admission(0, 1));
	now = 6;
	await pump.sendTerminal(new Uint8Array([2]), admission(1, 2));
	await waitFor(() => transport.sent.length === 2);
	assert.deepEqual(transport.sent.map((frame) => [...frame]), [[1], [7]]);
	assert.equal(congestion.length, 1);
});

test('detaching a lane blocked in transport drops later output and releases scheduler state', async () => {
	const transport = new ControlledTransport();
	await transport.open();
	transport.blockWrites = true;
	const pump = new OutboundDeliveryPump(
		transport,
		{ maxQueuedBytes: 32 },
		() => undefined,
	);
	const admission = (position, nextPosition) => ({
		laneId: 'attachment-detached',
		position,
		nextPosition,
		createResyncFrame: () => new Uint8Array([7]),
	});
	const active = pump.sendTerminal(new Uint8Array([1]), admission(0, 1));
	await immediate();
	pump.releaseTerminal('attachment-detached');
	await pump.sendTerminal(new Uint8Array([2]), admission(1, 2));

	transport.releaseWrites();
	await active;
	await waitFor(() => pump.snapshot.queuedFrames === 0);
	assert.deepEqual(transport.sent.map((frame) => [...frame]), [[1]]);
});

test('sustained terminal output remains live while rendered acknowledgements advance', async () => {
	const transport = new ControlledTransport();
	await transport.open();
	const congestion = [];
	const pump = new OutboundDeliveryPump(
		transport,
		{
			maxQueuedBytes: 32,
			maxTerminalUnconfirmedBytes: 2,
		},
		() => undefined,
		(value) => congestion.push(value),
	);
	const admission = (position, nextPosition) => ({
		laneId: 'attachment-a',
		position,
		nextPosition,
		createResyncFrame: () => new Uint8Array([7]),
	});

	for (let position = 0; position < 100; position += 1) {
		await pump.sendTerminal(
			new Uint8Array([position]),
			admission(position, position + 1),
		);
		pump.acknowledgeTerminal('attachment-a', position + 1);
	}
	await waitFor(() => transport.sent.length === 100);

	assert.equal(congestion.length, 0);
	assert.equal(transport.sent.at(-1)?.[0], 99);
});

test('a stalled renderer stays bounded while another terminal and workspace control remain responsive', async () => {
	const transport = new ControlledTransport();
	await transport.open();
	const congestion = [];
	const failures = [];
	const pump = new OutboundDeliveryPump(
		transport,
		{
			maxQueuedBytes: 64,
			maxQueuedFrames: 8,
			maxTerminalQueuedBytes: 8,
			maxTerminalQueuedFrames: 4,
			maxTerminalUnconfirmedBytes: 2,
		},
		(error) => failures.push(error),
		(value) => congestion.push(value),
	);
	const noisy = (position) => ({
		laneId: 'terminal-stalled',
		position,
		nextPosition: position + 1,
		createResyncFrame: () => new Uint8Array([200]),
	});
	const interactive = (position) => ({
		laneId: 'terminal-interactive',
		position,
		nextPosition: position + 1,
		createResyncFrame: () => new Uint8Array([201]),
	});
	let maximumQueuedBytes = 0;
	let maximumQueuedFrames = 0;
	let interactivePosition = 0;

	for (let position = 0; position < 10_000; position += 1) {
		await pump.sendTerminal(new Uint8Array([1]), noisy(position));
		if (position % 100 === 0) {
			await pump.sendTerminal(new Uint8Array([100]), interactive(interactivePosition));
			interactivePosition += 1;
			pump.acknowledgeTerminal('terminal-interactive', interactivePosition);
			await pump.send(new Uint8Array([250]));
		}
		maximumQueuedBytes = Math.max(maximumQueuedBytes, pump.snapshot.queuedBytes);
		maximumQueuedFrames = Math.max(maximumQueuedFrames, pump.snapshot.queuedFrames);
	}
	await waitFor(() => pump.snapshot.queuedFrames === 0);

	assert.equal(congestion.length, 1, 'the stalled attachment enters one bounded resync state');
	assert.equal(congestion[0].laneId, 'terminal-stalled');
	assert.equal(transport.sent.filter((frame) => frame[0] === 200).length, 1);
	assert.equal(transport.sent.filter((frame) => frame[0] === 100).length, 100);
	assert.equal(transport.sent.filter((frame) => frame[0] === 250).length, 100);
	assert.equal(maximumQueuedBytes <= 64, true);
	assert.equal(maximumQueuedFrames <= 8, true);
	assert.deepEqual(failures, []);
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

test('a 200 MiB terminal producer resynchronizes its attachment without closing the shared application connection', async () => {
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
	void connection.start();
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
		for (let index = 0; index < 3_200; index += 1) {
			journal.append('terminal', {
				attachmentId: 'terminal-attachment',
				clientId: 'terminal-burst-client',
				projectId: 'project-a',
				serverId: 'terminal-burst-server',
				sessionId: 'session-a',
				type: 'output',
				position: index * 65_536,
				nextPosition: (index + 1) * 65_536,
				bytes: 'eA=='.repeat(192),
			});
		}
		transport.push(
			encodeFrame({
				type: 'command',
				commandId: 'unsubscribe-terminal',
				correlationId: 'unsubscribe-terminal-correlation',
				operation: 'events.unsubscribe',
				payload: { subscriptionId: 'terminal-events' },
			}),
		);
		await waitFor(() =>
			diagnostics.some(({ phase }) => phase === 'terminal_congestion'),
		);
		assert.equal(connection.state, 'open');
		transport.releaseWrites();
		await waitFor(() =>
			transport.sent.some((frame) => {
				const envelope = decodeFrame(frame).envelope;
				return envelope.type === 'event' &&
					envelope.event === 'terminal' &&
					envelope.payload.type === 'resync_required';
			}),
		);
		await waitFor(() =>
			transport.sent.some((frame) => {
				const envelope = decodeFrame(frame).envelope;
				return envelope.type === 'command_result' &&
					envelope.correlationId === 'unsubscribe-terminal-correlation';
			}),
		);
		assert.equal(connection.state, 'open');
		assert.equal(transport.closeCount, 0);
		assert.deepEqual(
			diagnostics.map(({ phase, code }) => ({ phase, code })),
			[{ phase: 'terminal_congestion', code: 'resource' }],
		);
		assert.equal(
			diagnostics[0].queuedBytes > 0,
			true,
			'a finite terminal backlog is measured on its attachment lane',
		);
	} finally {
		transport.releaseWrites();
		await connection.close().catch(() => undefined);
		transport.end();
	}
});

test('overlapping event subscriptions admit each live terminal byte range once without advancing the journal', async () => {
	const journal = new OrderedEventJournal();
	const transport = new ControlledTransport();
	const core = createServerCore({
		serverId: 'duplicate-terminal-server',
		serverVersion: 'test',
		capabilities: [],
		eventJournal: journal,
		authenticate: ({ hello }) => ({
			clientId: hello.clientId,
			authScope: 'read',
		}),
	});
	const connection = core.accept(transport);
	const run = connection.start();
	try {
		transport.push(encodeFrame({
			type: 'client_hello',
			protocolMin: 1,
			protocolMax: 1,
			clientId: 'duplicate-terminal-client',
			clientVersion: 'test',
			capabilities: ['events.resync'],
			limits: {},
		}));
		await waitFor(() => connection.state === 'open');

		for (const subscriptionId of ['all-events-a', 'all-events-b']) {
			transport.push(encodeFrame({
				type: 'command',
				commandId: `subscribe-${subscriptionId}`,
				correlationId: `subscribe-${subscriptionId}-correlation`,
				operation: 'events.subscribe',
				payload: {
					subscriptionId,
					fromRevision: 0,
				},
			}));
		}
		await waitFor(() => transport.sent.filter((frame) =>
			decodeFrame(frame).envelope.type === 'command_result',
		).length === 2);

		journal.publishTransient('terminal', {
			attachmentId: 'shared-attachment',
			clientId: 'duplicate-terminal-client',
			projectId: 'project-a',
			serverId: 'duplicate-terminal-server',
			sessionId: 'session-a',
			type: 'output',
			position: 0,
			nextPosition: 1,
			bytes: 'eA==',
		});
		await waitFor(() => transport.sent.some((frame) =>
			decodeFrame(frame).envelope.type === 'event',
		));
		await immediate();

		const terminalEvents = transport.sent
			.map((frame) => decodeFrame(frame).envelope)
			.filter((envelope) => envelope.type === 'event' && envelope.event === 'terminal');
		assert.equal(terminalEvents.length, 1);
		assert.equal(terminalEvents[0].revision, 0);
		assert.equal(terminalEvents[0].payload.attachmentId, 'shared-attachment');

		journal.publishTransient('terminal', {
			attachmentId: 'shared-attachment',
			clientId: 'duplicate-terminal-client',
			projectId: 'project-a',
			serverId: 'duplicate-terminal-server',
			sessionId: 'session-a',
			type: 'output',
			position: 1,
			nextPosition: 2,
			bytes: 'eQ==',
		});
		await waitFor(() => transport.sent
			.map((frame) => decodeFrame(frame).envelope)
			.filter((envelope) => envelope.type === 'event' && envelope.event === 'terminal')
			.length === 2);
		assert.equal(journal.revision, 0);

		journal.append('workspace', { projectId: 'project-a', changed: true });
		await waitFor(() => transport.sent
			.map((frame) => decodeFrame(frame).envelope)
			.filter((envelope) => envelope.type === 'event' && envelope.event === 'workspace')
			.length === 2);
		assert.equal(
			transport.sent
				.map((frame) => decodeFrame(frame).envelope)
				.filter((envelope) => envelope.type === 'event' && envelope.event === 'workspace')
				.length,
			2,
			'ordinary events retain one delivery per independent subscription',
		);
		assert.equal(connection.state, 'open');
	} finally {
		await connection.close().catch(() => undefined);
		transport.end();
		await run;
	}
});

test('a binary-output-capable terminal subscriber receives raw frame bytes without base64 payload data', async () => {
	const journal = new OrderedEventJournal();
	const transport = new ControlledTransport();
	const core = createServerCore({
		serverId: 'binary-terminal-server',
		serverVersion: 'test',
		capabilities: [],
		eventJournal: journal,
		authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: 'read' }),
	});
	const connection = core.accept(transport);
	const run = connection.start();
	try {
		transport.push(
			encodeFrame({
				type: 'client_hello',
				protocolMin: 1,
				protocolMax: 1,
				clientId: 'binary-terminal-client',
				clientVersion: 'test',
				capabilities: ['events.resync', 'terminal.binary-output'],
				limits: {},
			}),
		);
		await waitFor(() => connection.state === 'open');
		transport.push(
			encodeFrame({
				type: 'command',
				commandId: 'binary-terminal-subscribe',
				correlationId: 'binary-terminal-subscribe-correlation',
				operation: 'events.subscribe',
				payload: { subscriptionId: 'binary-terminal-subscription', fromRevision: 0 },
			}),
		);
		await waitFor(() =>
			transport.sent.some(
				(frame) => decodeFrame(frame).envelope.type === 'command_result',
			),
		);

		journal.publishTransient(
			'terminal',
			{
				attachmentId: 'binary-terminal-attachment',
				clientId: 'binary-terminal-client',
				projectId: 'project-a',
				serverId: 'binary-terminal-server',
				sessionId: 'session-a',
				type: 'output',
				position: 0,
				nextPosition: 3,
			},
			new Uint8Array([0, 0xff, 0x1b]),
		);
		await waitFor(() =>
			transport.sent.some((frame) => {
				const decoded = decodeFrame(frame);
				return decoded.envelope.type === 'event' && decoded.envelope.event === 'terminal';
			}),
		);

		const frame = transport.sent
			.map((candidate) => decodeFrame(candidate))
			.find(
				(candidate) =>
					candidate.envelope.type === 'event' &&
					candidate.envelope.event === 'terminal',
			);
		assert.deepEqual([...frame.body], [0, 0xff, 0x1b]);
		assert.equal(frame.envelope.payload.bytes, undefined);
	} finally {
		await connection.close().catch(() => undefined);
		transport.end();
		await run;
	}
});

test('a legacy terminal subscriber receives a base64 fallback for a raw live body', async () => {
	const journal = new OrderedEventJournal();
	const transport = new ControlledTransport();
	const core = createServerCore({
		serverId: 'legacy-terminal-server',
		serverVersion: 'test',
		capabilities: [],
		eventJournal: journal,
		authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: 'read' }),
	});
	const connection = core.accept(transport);
	const run = connection.start();
	try {
		transport.push(encodeFrame({
			type: 'client_hello',
			protocolMin: 1,
			protocolMax: 1,
			clientId: 'legacy-terminal-client',
			clientVersion: 'test',
			capabilities: ['events.resync'],
			limits: {},
		}));
		await waitFor(() => connection.state === 'open');
		transport.push(encodeFrame({
			type: 'command',
			commandId: 'legacy-terminal-subscribe',
			correlationId: 'legacy-terminal-subscribe-correlation',
			operation: 'events.subscribe',
			payload: { subscriptionId: 'legacy-terminal-subscription', fromRevision: 0 },
		}));
		await waitFor(() => transport.sent.some((frame) => decodeFrame(frame).envelope.type === 'command_result'));

		journal.publishTransient('terminal', {
			attachmentId: 'legacy-terminal-attachment',
			clientId: 'legacy-terminal-client',
			projectId: 'project-a',
			serverId: 'legacy-terminal-server',
			sessionId: 'session-a',
			type: 'output',
			position: 0,
			nextPosition: 3,
		}, new Uint8Array([0, 0xff, 0x1b]));
		await waitFor(() => transport.sent.some((frame) => {
			const decoded = decodeFrame(frame);
			return decoded.envelope.type === 'event' && decoded.envelope.event === 'terminal';
		}));

		const frame = transport.sent
			.map((candidate) => decodeFrame(candidate))
			.find((candidate) => candidate.envelope.type === 'event' && candidate.envelope.event === 'terminal');
		assert.equal(frame.body.byteLength, 0);
		assert.equal(frame.envelope.payload.bytes, 'AP8b');
	} finally {
		await connection.close().catch(() => undefined);
		transport.end();
		await run;
	}
});

test('a congested terminal lane resumes after the client confirms the resync boundary', async () => {
	const transport = new ControlledTransport();
	await transport.open();
	transport.blockWrites = true;
	const failures = [];
	const congestion = [];
	const pump = new OutboundDeliveryPump(
		transport,
		{
			maxQueuedBytes: 64,
			maxQueuedFrames: 8,
			maxTerminalQueuedBytes: 8,
			maxTerminalQueuedFrames: 2,
		},
		(error) => failures.push(error),
		(value) => congestion.push(value),
	);
	const lane = (position, nextPosition) => ({
		laneId: 'attachment-a',
		position,
		nextPosition,
		createResyncFrame: () => new Uint8Array([7]),
	});
	const admitted = [
		pump.sendTerminal(new Uint8Array([1]), lane(0, 1)),
		pump.sendTerminal(new Uint8Array([2]), lane(1, 2)),
		pump.sendTerminal(new Uint8Array([3]), lane(2, 3)),
	];
	await immediate();
	assert.equal(congestion.length, 1, 'the lane enters one bounded resync state');

	transport.releaseWrites();
	await Promise.all(admitted);
	await waitFor(() => pump.snapshot.queuedFrames === 0);
	const sentBeforeRecovery = transport.sent.length;

	// While the client has not confirmed the discarded boundary, obsolete output
	// stays superseded rather than queueing behind a stale cursor.
	await pump.sendTerminal(new Uint8Array([4]), lane(3, 4));
	await waitFor(() => pump.snapshot.queuedFrames === 0);
	assert.equal(transport.sent.length, sentBeforeRecovery, 'an unconfirmed lane admits nothing');

	// Confirming the resynchronization boundary ends the recovery state. The
	// lane is a bounded state, never a permanent mute.
	pump.acknowledgeTerminal('attachment-a', 3);
	await pump.sendTerminal(new Uint8Array([5]), lane(3, 4));
	await waitFor(() => pump.snapshot.queuedFrames === 0);
	assert.deepEqual(
		transport.sent.slice(sentBeforeRecovery).map((frame) => [...frame]),
		[[5]],
		'the acknowledged lane streams live output again',
	);
	assert.deepEqual(failures, []);
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
