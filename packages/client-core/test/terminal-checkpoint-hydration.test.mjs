import assert from 'node:assert/strict';
import test from 'node:test';
import {
	MAX_TERMINAL_HYDRATION_QUEUE_BYTES,
	TERMINAL_PRESENTATION_CHECKPOINT_OPERATION,
	TerminayTerminalClient,
} from '../dist/index.js';

const identity = Object.freeze({
	serverId: 'checkpoint-server',
	projectId: 'checkpoint-project',
	sessionId: 'checkpoint-session',
});

function metadata(overrides = {}) {
	return {
		...identity,
		checkpointId: 'opaque-checkpoint-id',
		position: 1_100_000,
		headPosition: 1_100_000,
		checkpointDimensions: { cols: 120, rows: 40 },
		dimensions: { cols: 120, rows: 40 },
		formatVersion: 1,
		stateByteLength: 1_100_000,
		tailByteLength: 0,
		byteLength: 1_100_000,
		expiresAt: 4_000_000_000_000,
		...overrides,
	};
}

function hydrationTransport({
	checkpoint = metadata(),
	initialEvents = [],
	onFetch,
} = {}) {
	const calls = [];
	const listeners = new Set();
	const attachmentId = 'checkpoint-attachment';
	const clientId = 'checkpoint-client';
	const emit = (payload, body) => {
		for (const listener of listeners) {
			listener({
				subscriptionId: 'checkpoint-subscription',
				revision: 1,
				cursor: '1',
				event: 'terminal',
				payload,
				...(body === undefined ? {} : { body }),
			});
		}
	};
	return {
		attachmentId,
		calls,
		clientId,
		emit,
		async command(operation, payload) {
			calls.push([operation, payload]);
			if (operation === 'terminal.attach') {
				return {
					attachmentId,
					fromPosition: checkpoint.headPosition,
					position: checkpoint.headPosition,
					presentation: { ...identity, revision: 1, role: 'read_only' },
					checkpoint,
					events: initialEvents,
				};
			}
			return null;
		},
		async queryWithBody(operation, payload) {
			calls.push([operation, payload]);
			if (operation !== TERMINAL_PRESENTATION_CHECKPOINT_OPERATION) {
				throw new Error(`unexpected binary query ${operation}`);
			}
			return await onFetch({ checkpoint, emit, payload });
		},
		async subscribe() {
			return {
				id: 'checkpoint-subscription',
				fromRevision: 0,
				unsubscribe: async () => listeners.clear(),
				onEvent(listener) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
			};
		},
	};
}

test('fresh checkpoint hydration keeps a >1 MiB snapshot out of attach headers and drains subscribed tail exactly once', async () => {
	const checkpointBytes = new Uint8Array(1_100_000).fill(0x78);
	const preSubscriptionTail = new TextEncoder().encode(
		'tail-written-after-safe-checkpoint-before-subscribe',
	);
	const liveTail = new TextEncoder().encode(
		'tail-written-during-checkpoint-fetch',
	);
	const checkpoint = metadata({ stateByteLength: checkpointBytes.byteLength, byteLength: checkpointBytes.byteLength });
	const transport = hydrationTransport({
		checkpoint,
		initialEvents: [
			{
				...identity,
				attachmentId: 'checkpoint-attachment',
				clientId: 'checkpoint-client',
				type: 'output',
				position: checkpoint.position,
				nextPosition: checkpoint.position + preSubscriptionTail.byteLength,
				bytes: Buffer.from(preSubscriptionTail).toString('base64'),
				replay: true,
			},
		],
		onFetch: async ({ emit, payload }) => {
			assert.deepEqual(payload, {
				clientId: 'checkpoint-client',
				attachmentId: 'checkpoint-attachment',
				checkpointId: checkpoint.checkpointId,
				identity,
			});
			emit(
				{
					...identity,
					attachmentId: 'checkpoint-attachment',
					clientId: 'checkpoint-client',
					type: 'output',
					position: checkpoint.position + preSubscriptionTail.byteLength,
					nextPosition:
						checkpoint.position +
						preSubscriptionTail.byteLength +
						liveTail.byteLength,
				},
				liveTail,
			);
			return { result: { ...checkpoint, tail: [] }, body: checkpointBytes };
		},
	});
	const client = new TerminayTerminalClient(transport);

	const attachment = await client.attach({
		...identity,
		clientId: transport.clientId,
		freshPresentation: true,
	});

	const attachPayload = transport.calls.find(
		([operation]) => operation === 'terminal.attach',
	)[1];
	assert.equal(JSON.stringify(attachPayload).length < 4_096, true);
	assert.equal('checkpoint' in attachPayload, false);
	assert.equal('snapshot' in attachPayload, false);
	assert.deepEqual(
		attachment.initialEvents.map((event) => event.type),
		['checkpoint', 'output', 'output'],
	);
	assert.equal(
		attachment.initialEvents[0].bytes.byteLength,
		checkpointBytes.byteLength,
	);
	assert.deepEqual(attachment.initialEvents[1].bytes, preSubscriptionTail);
	assert.deepEqual(attachment.initialEvents[2].bytes, liveTail);
	assert.equal(
		attachment.position,
		checkpoint.position + preSubscriptionTail.byteLength + liveTail.byteLength,
	);

	const delivered = [];
	attachment.onEvent((event) => delivered.push(event));
	transport.emit(
		{
			...identity,
			attachmentId: transport.attachmentId,
			clientId: transport.clientId,
			type: 'output',
			position:
				checkpoint.position +
				preSubscriptionTail.byteLength +
				liveTail.byteLength,
			nextPosition:
				checkpoint.position +
				preSubscriptionTail.byteLength +
				liveTail.byteLength +
				4,
		},
		new Uint8Array([0, 1, 2, 3]),
	);
	assert.deepEqual(
		delivered.map((event) => [...event.bytes]),
		[[0, 1, 2, 3]],
	);
	await attachment.detach();
});

test('fresh hydration restores a parser-safe snapshot then replays its binary parser tail before subscribed live output', async () => {
	const snapshot = new Uint8Array([0x1b, 0x5b, 0x48]);
	const parserTail = new TextEncoder().encode('\u001b]8;;https://example.test\u0007');
	const checkpoint = metadata({
		position: 10,
		headPosition: 10 + parserTail.byteLength,
		stateByteLength: snapshot.byteLength,
		tailByteLength: parserTail.byteLength,
		byteLength: snapshot.byteLength + parserTail.byteLength,
	});
	const live = new TextEncoder().encode('after-tail');
	const transport = hydrationTransport({
		checkpoint,
		onFetch: async ({ emit }) => {
			emit(
				{
					...identity,
					attachmentId: 'checkpoint-attachment',
					clientId: 'checkpoint-client',
					type: 'output',
					position: checkpoint.headPosition,
					nextPosition: checkpoint.headPosition + live.byteLength,
				},
				live,
			);
			return { result: { ...checkpoint, tail: [{ type: 'output', position: checkpoint.position, nextPosition: checkpoint.headPosition, byteLength: parserTail.byteLength }] }, body: new Uint8Array([...snapshot, ...parserTail]) };
		},
	});
	const attachment = await new TerminayTerminalClient(transport).attach({
		...identity,
		clientId: transport.clientId,
		freshPresentation: true,
	});
	assert.deepEqual(attachment.initialEvents.map((event) => event.type), [
		'checkpoint',
		'output',
		'output',
	]);
	assert.deepEqual(attachment.initialEvents[0].bytes, snapshot);
	assert.equal(attachment.initialEvents[0].position, checkpoint.position);
	assert.deepEqual(attachment.initialEvents[1].bytes, parserTail);
	assert.equal(attachment.initialEvents[1].position, checkpoint.position);
	assert.equal(attachment.initialEvents[1].nextPosition, checkpoint.headPosition);
	assert.deepEqual(attachment.initialEvents[2].bytes, live);
	await attachment.detach();
});

test('checkpoint hydration fails closed and detaches when the subscribed handoff queue exceeds its byte ceiling', async () => {
	const checkpoint = metadata({ stateByteLength: 1, byteLength: 1 });
	const overflow = new Uint8Array(MAX_TERMINAL_HYDRATION_QUEUE_BYTES + 1);
	const transport = hydrationTransport({
		checkpoint,
		onFetch: async ({ emit }) => {
			emit(
				{
					...identity,
					attachmentId: 'checkpoint-attachment',
					clientId: 'checkpoint-client',
					type: 'output',
					position: checkpoint.position,
					nextPosition: checkpoint.position + overflow.byteLength,
				},
				overflow,
			);
			return { result: { ...checkpoint, tail: [] }, body: new Uint8Array([0]) };
		},
	});
	const client = new TerminayTerminalClient(transport);

	await assert.rejects(
		client.attach({
			...identity,
			clientId: transport.clientId,
			freshPresentation: true,
		}),
		/terminal hydration queue exceeds its byte limit/,
	);
	assert.equal(
		transport.calls.some(([operation]) => operation === 'terminal.detach'),
		true,
		'the failed attachment must be released without affecting the session',
	);
});

test('checkpoint hydration rejects a binary response whose exact project/session identity differs from its pin', async () => {
	const checkpoint = metadata({ stateByteLength: 1, byteLength: 1 });
	const transport = hydrationTransport({
		checkpoint,
		onFetch: async () => ({
			result: { ...checkpoint, projectId: 'other-project' },
			body: new Uint8Array([0]),
		}),
	});
	const client = new TerminayTerminalClient(transport);

	await assert.rejects(
		client.attach({
			...identity,
			clientId: transport.clientId,
			freshPresentation: true,
		}),
		/terminal checkpoint identity is invalid/,
	);
	assert.equal(
		transport.calls.some(([operation]) => operation === 'terminal.detach'),
		true,
		'a mismatched checkpoint cannot leave an attachment pin live',
	);
});
