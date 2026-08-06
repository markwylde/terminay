import assert from 'node:assert/strict';
import test from 'node:test';
import { TerminayTerminalClient } from '../dist/index.js';

const identity = {
	serverId: 'server-a',
	projectId: 'project-a',
	sessionId: 'session-a',
};

function output(position, text, replay = false) {
	const bytes = new TextEncoder().encode(text);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return {
		...identity,
		type: 'output',
		position,
		nextPosition: position + bytes.length,
		bytes: btoa(binary),
		replay,
	};
}

function fakeTransport() {
	const calls = [];
	const listeners = new Set();
	let attachment = 0;
	let currentAttachmentId;
	let currentClientId;
	return {
		calls,
		emit(payload, body) {
			const routedPayload =
				typeof payload === 'object' &&
				payload !== null &&
				!Array.isArray(payload) &&
				typeof payload.type === 'string' &&
				typeof payload.attachmentId !== 'string' &&
				typeof currentAttachmentId === 'string' &&
				typeof currentClientId === 'string'
					? {
							...payload,
							attachmentId: currentAttachmentId,
							clientId: currentClientId,
						}
					: payload;
			for (const listener of listeners)
				listener({
					subscriptionId: 'sub',
					revision: 1,
					cursor: '1',
					event: 'terminal',
					payload: routedPayload,
					...(body === undefined ? {} : { body }),
				});
		},
		async command(operation, payload) {
			calls.push([operation, payload]);
			if (operation === 'terminal.attach' || operation === 'terminal.resume') {
				attachment += 1;
				currentAttachmentId = `attachment-${attachment}`;
				currentClientId = payload.clientId;
				return {
					attachmentId: currentAttachmentId,
					presentation: { ...payload.identity, revision: 0, role: 'read_only' },
					fromPosition: payload.fromPosition,
					position: payload.fromPosition,
					events:
						payload.fromPosition === 0
							? [
									{
										...output(0, 'abc', true),
										...(typeof payload.identity === 'object' &&
										payload.identity !== null
											? payload.identity
											: {}),
										attachmentId: currentAttachmentId,
										clientId: currentClientId,
									},
								]
							: [],
				};
			}
			return null;
		},
		async subscribe() {
			return {
				id: 'sub',
				fromRevision: 0,
				unsubscribe: async () => {
					listeners.clear();
				},
				onEvent(listener) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
			};
		},
	};
}

test('TerminayTerminalClient attaches, detaches, resumes, and suppresses duplicate output', async () => {
	const transport = fakeTransport();
	const client = new TerminayTerminalClient(transport);
	const first = await client.attach({ ...identity, clientId: 'client-a' });
	assert.equal(first.position, 3);
	assert.deepEqual(
		[...first.initialEvents].map((event) => event.type),
		['output'],
	);

	const events = [];
	first.onEvent((event) => events.push(event));
	transport.emit(output(0, 'abc', true));
	transport.emit(output(3, 'def'));
	assert.deepEqual(
		events.map((event) => new TextDecoder().decode(event.bytes)),
		['def'],
	);
	assert.equal(first.position, 6);

	await first.ack(6);
	await first.detach();
	assert.equal(first.closed, true);
	assert.equal(transport.calls.at(-1)[0], 'terminal.detach');

	const resumed = await client.resume({
		...identity,
		clientId: 'client-a',
		fromPosition: 0,
	});
	assert.equal(resumed.position, 3);
	const resumedEvents = [];
	resumed.onEvent((event) => resumedEvents.push(event));
	transport.emit(output(3, 'def', true));
	const rawBody = new TextEncoder().encode('ghi');
	transport.emit(
		{ ...identity, type: 'output', position: 6, nextPosition: 9 },
		rawBody,
	);
	assert.deepEqual(
		resumedEvents.map((event) => new TextDecoder().decode(event.bytes)),
		['def', 'ghi'],
	);
	assert.equal(
		transport.calls
			.filter(([operation]) => operation === 'terminal.resume')
			.at(-1)[1].fromPosition,
		0,
	);
	await resumed.detach();
});

test('an explicit display cursor replays behind the reconnect watermark for a fresh surface', async () => {
	const transport = fakeTransport();
	transport.command = async (operation, payload) => {
		transport.calls.push([operation, payload]);
		if (operation === 'terminal.attach' || operation === 'terminal.resume') {
			return {
				attachmentId: `${operation}-attachment`,
				fromPosition: payload.fromPosition,
				position: 6,
				events: payload.fromPosition === 0 ? [output(0, 'abcdef', true)] : [],
			};
		}
		return null;
	};
	const client = new TerminayTerminalClient(transport);
	const first = await client.attach({ ...identity, clientId: 'client-a' });
	assert.equal(first.position, 6);
	await first.detach();
	const moved = await client.resume({
		...identity,
		clientId: 'client-a',
		fromPosition: 0,
	});
	assert.equal(
		transport.calls
			.filter(([operation]) => operation === 'terminal.resume')
			.at(-1)[1].fromPosition,
		0,
	);
	assert.equal(
		new TextDecoder().decode(moved.initialEvents[0].bytes),
		'abcdef',
	);
	assert.equal(moved.position, 6);
	await moved.detach();
});

test('a remounted blank emulator forces position-zero recovery despite a reconnect watermark', async () => {
	const transport = fakeTransport();
	const client = new TerminayTerminalClient(transport);
	const first = await client.attach({ ...identity, clientId: 'client-a' });
	assert.equal(first.position, 3);
	transport.emit(output(3, 'def'));
	assert.equal(first.position, 6);
	await first.detach();
	const fresh = await client.resume({ ...identity, clientId: 'client-a', freshPresentation: true });
	const call = transport.calls.filter(([operation]) => operation === 'terminal.resume').at(-1);
	assert.equal(call[1].fromPosition, 0);
	assert.equal(call[1].freshPresentation, true);
	assert.equal(new TextDecoder().decode(fresh.initialEvents[0].bytes), 'abc');
	await fresh.detach();
});

test('output arriving during the subscription handoff is retained in initial events', async () => {
	const listeners = new Set();
	const transport = {
		async command(operation, payload) {
			if (operation === 'terminal.attach')
				return {
					attachmentId: 'fast',
					fromPosition: payload.fromPosition,
					position: 0,
					events: [],
				};
			return null;
		},
		async subscribe() {
			return {
				id: 'fast-sub',
				fromRevision: 0,
				unsubscribe: async () => {},
				onEvent(listener) {
					listeners.add(listener);
					listener({
						subscriptionId: 'fast-sub',
						revision: 1,
						cursor: '1',
						event: 'terminal',
						payload: {
							...output(0, 'fast'),
							attachmentId: 'fast',
							clientId: 'client-a',
						},
					});
					return () => listeners.delete(listener);
				},
			};
		},
	};
	const client = new TerminayTerminalClient(transport);
	const attachment = await client.attach({ ...identity, clientId: 'client-a' });
	assert.equal(
		new TextDecoder().decode(attachment.initialEvents[0].bytes),
		'fast',
	);
	assert.equal(attachment.position, 4);
	await attachment.detach();
});

test('TerminayTerminalClient creates a server-owned terminal session', async () => {
	const transport = fakeTransport();
	transport.command = async (operation, payload) => {
		transport.calls.push([operation, payload]);
		if (operation === 'terminal.create')
			return {
				serverId: 'server-a',
				projectId: payload.projectId,
				sessionId: 'server-session',
				cwd: payload.cwd ?? '.',
				status: 'running',
				createdAt: 1,
				outputPosition: 0,
				replayFrom: 0,
				dimensions: { cols: payload.cols ?? 80, rows: payload.rows ?? 24 },
				pid: 123,
			};
		return null;
	};
	const client = new TerminayTerminalClient(transport);
	const session = await client.create({
		projectId: 'project-a',
		profileId: 'profile-zsh',
		activePanelId: 'panel-a',
		cwd: '/workspace',
		cols: 120,
		rows: 40,
	});
	assert.equal(session.sessionId, 'server-session');
	assert.deepEqual(session.dimensions, { cols: 120, rows: 40 });
	assert.equal(transport.calls[0][0], 'terminal.create');
	assert.deepEqual(transport.calls[0][1], {
		projectId: 'project-a',
		profileId: 'profile-zsh',
		activePanelId: 'panel-a',
		cwd: '/workspace',
		cols: 120,
		rows: 40,
	});
});

test('TerminayTerminalClient waits on canonical server inactivity with exact identity', async () => {
	const calls = [];
	const client = new TerminayTerminalClient({
		async query(operation, payload) {
			calls.push({ operation, payload });
			return {
				result: {
					serverId: 'server-a',
					projectId: payload.projectId,
					sessionId: payload.sessionId,
					inactive: true,
				},
			};
		},
		async command() {
			throw new Error('unexpected command');
		},
		async subscribe() {
			throw new Error('unexpected subscription');
		},
	});
	await client.waitForInactivity('project-a', 'session-a', 250);
	assert.deepEqual(calls, [
		{
			operation: 'terminal.wait-inactivity',
			payload: {
				projectId: 'project-a',
				sessionId: 'session-a',
				durationMs: 250,
			},
		},
	]);
	await assert.rejects(
		() => client.waitForInactivity('project-a', 'session-a', -1),
		/duration/u,
	);
});

test('TerminayTerminalClient reads live cwd without mutating spawn metadata', async () => {
	const calls = [];
	const client = new TerminayTerminalClient({
		async query(operation, payload) {
			calls.push({ operation, payload });
			return {
				result: {
					serverId: 'server-a',
					projectId: payload.projectId,
					sessionId: payload.sessionId,
					cwd: '/workspace/live',
					source: 'observed',
				},
			};
		},
		async command() {
			throw new Error('unexpected command');
		},
		async subscribe() {
			throw new Error('unexpected subscription');
		},
	});
	assert.deepEqual(await client.currentCwd('project-a', 'session-a'), {
		serverId: 'server-a',
		projectId: 'project-a',
		sessionId: 'session-a',
		cwd: '/workspace/live',
		source: 'observed',
	});
	assert.deepEqual(calls, [
		{
			operation: 'terminal.cwd',
			payload: { projectId: 'project-a', sessionId: 'session-a' },
		},
	]);
});

test('TerminayTerminalClient ignores live terminal events that cross the identity boundary', async () => {
	const transport = fakeTransport();
	const client = new TerminayTerminalClient(transport);
	const attachment = await client.attach({ ...identity, clientId: 'client-a' });
	const events = [];
	attachment.onEvent((event) => events.push(event));
	assert.doesNotThrow(() =>
		transport.emit({ ...output(3, 'x'), projectId: 'project-other' }),
	);
	assert.deepEqual(events, []);
	await attachment.detach();
});

test('TerminayTerminalClient ignores multiplexed events for other terminal attachments', async () => {
	const transport = fakeTransport();
	const client = new TerminayTerminalClient(transport);
	const attachment = await client.attach({ ...identity, clientId: 'client-a' });
	const events = [];
	attachment.onEvent((event) => events.push(event));

	transport.emit({
		...output(3, 'ignored'),
		projectId: 'project-other',
		attachmentId: 'attachment-other',
		clientId: 'client-a',
	});
	transport.emit({
		...output(3, 'ignored'),
		projectId: 'project-other',
		attachmentId: attachment.attachmentId,
		clientId: 'client-other',
	});
	transport.emit({
		...output(3, 'ok'),
		attachmentId: attachment.attachmentId,
		clientId: 'client-a',
	});

	assert.deepEqual(
		events.map((event) => new TextDecoder().decode(event.bytes)),
		['ok'],
	);
	await attachment.detach();
});

test('TerminayTerminalClient keeps same-browser terminal attachments isolated', async () => {
	const transport = fakeTransport();
	const client = new TerminayTerminalClient(transport);
	const first = await client.attach({
		...identity,
		sessionId: 'session-a',
		clientId: 'client-a',
	});
	const second = await client.attach({
		...identity,
		sessionId: 'session-b',
		clientId: 'client-a',
		fromPosition: 3,
	});
	const firstEvents = [];
	const secondEvents = [];
	first.onEvent((event) => firstEvents.push(event));
	second.onEvent((event) => secondEvents.push(event));

	assert.doesNotThrow(() => {
		transport.emit({
			type: 'output',
			attachmentId: first.attachmentId,
			clientId: 'client-a',
			position: 3,
			nextPosition: 6,
			bytes: 'YmFk',
		});
	});
	transport.emit({
		...output(3, 'two'),
		sessionId: 'session-b',
		attachmentId: second.attachmentId,
		clientId: 'client-a',
	});
	transport.emit({
		...output(3, 'one'),
		attachmentId: first.attachmentId,
		clientId: 'client-a',
	});

	assert.deepEqual(
		firstEvents.map((event) => new TextDecoder().decode(event.bytes)),
		['one'],
	);
	assert.deepEqual(
		secondEvents.map((event) => new TextDecoder().decode(event.bytes)),
		['two'],
	);
	await first.detach();
	await second.detach();
});

test('TerminayTerminalClient ignores mismatched initial replay without disconnecting the attachment', async () => {
	const listeners = new Set();
	const calls = [];
	const transport = {
		calls,
		emit(payload) {
			for (const listener of listeners) {
				listener({
					subscriptionId: 'sub',
					revision: 1,
					cursor: '1',
					event: 'terminal',
					payload,
				});
			}
		},
		async command(operation, payload) {
			calls.push([operation, payload]);
			if (operation === 'terminal.attach') {
				return {
					attachmentId: 'attachment-a',
					fromPosition: payload.fromPosition,
					position: payload.fromPosition,
					events: [
						{
							...output(0, 'wrong', true),
							projectId: 'project-other',
							attachmentId: 'attachment-a',
							clientId: 'client-a',
						},
					],
				};
			}
			return null;
		},
		async subscribe() {
			return {
				id: 'sub',
				fromRevision: 0,
				unsubscribe: async () => {
					listeners.clear();
				},
				onEvent(listener) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
			};
		},
	};
	const client = new TerminayTerminalClient(transport);
	const attachment = await client.attach({ ...identity, clientId: 'client-a' });
	assert.deepEqual(attachment.initialEvents, []);

	const events = [];
	attachment.onEvent((event) => events.push(event));
	transport.emit({
		...output(0, 'ok'),
		attachmentId: attachment.attachmentId,
		clientId: 'client-a',
	});

	assert.deepEqual(
		events.map((event) => new TextDecoder().decode(event.bytes)),
		['ok'],
	);
	await attachment.write('x');
	assert.equal(transport.calls.at(-1)[0], 'terminal.input');
	await attachment.detach();
});

test('TerminayTerminalClient rejects a conflicting compatibility authorization identity', async () => {
	const transport = fakeTransport();
	const client = new TerminayTerminalClient(transport);

	await assert.rejects(
		() =>
			client.attach({
				...identity,
				clientId: 'client-a',
				authorization: {
					...identity,
					sessionId: 'legacy-session',
					scope: 'write',
				},
			}),
		/authorization identity must match the attachment identity/,
	);
	assert.deepEqual(transport.calls, []);
});
