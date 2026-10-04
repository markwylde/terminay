import test from 'node:test';
import assert from 'node:assert/strict';
import {
	TerminayClient,
	TerminayClientFacade,
	TerminayTerminalClient,
} from '@terminay/client-core';
import { createInMemoryTransportPair } from '@terminay/protocol-conformance';
import {
	createServerCore,
	createTerminalOperationRegistry,
	OrderedEventJournal,
	TerminalPresentationCheckpointAuthority,
	TerminalService,
} from '../dist/index.js';

/**
 * A terminal kept running across a restart must come back showing its current
 * screen.
 *
 * Adoption hands the new server everything the session holder retained in one
 * burst, and the window attaches while the checkpoint authority is still
 * working through it. A fresh presentation pinned part-way through that burst
 * paints an old screen, and because the remainder is larger than a
 * presentation lane carries it is skipped rather than replayed. A program that
 * then stays quiet never repaints, so the stale screen is what the user keeps.
 */

const SERVER_ID = 'server-adopted';
const identity = {
	serverId: SERVER_ID,
	projectId: 'project-adopted',
	sessionId: 'session-adopted',
};

/** A process whose retained output is delivered as soon as it is observed,
 * exactly as a session holder stream does. */
function heldProcess(retained) {
	const dataListeners = new Set();
	let delivered = false;
	return {
		pid: 4242,
		write() {},
		resize() {},
		kill() {},
		pause() {},
		resume() {},
		onData(listener) {
			dataListeners.add(listener);
			if (!delivered) {
				delivered = true;
				for (const bytes of retained) listener(bytes);
			}
			return () => dataListeners.delete(listener);
		},
		onExit() {
			return () => undefined;
		},
	};
}

/** About a megabyte of full-screen repaints, ending on a recognisable one. */
function retainedOutput() {
	const encoder = new TextEncoder();
	const chunks = [];
	const row =
		'\u001b[38;5;244mrow of earlier output that fills the line\u001b[0m '.repeat(
			2,
		);
	for (let frame = 0; frame < 250; frame += 1) {
		let text = '\u001b[2J\u001b[H';
		for (let line = 0; line < 22; line += 1)
			text += `${frame}:${line} ${row}\r\n`;
		chunks.push(encoder.encode(text));
	}
	chunks.push(encoder.encode('\u001b[2J\u001b[Hcurrent-screen-marker\r\n'));
	return chunks;
}

test('an adopted terminal first presents the screen it was left on', async () => {
	const checkpoints = new TerminalPresentationCheckpointAuthority();
	const service = new TerminalService({
		serverId: SERVER_ID,
		ptyFactory: {
			spawn() {
				throw new Error('nothing is spawned for an adopted session');
			},
		},
		presentationCheckpoints: checkpoints,
	});
	const retained = retainedOutput();
	const retainedBytes = retained.reduce(
		(sum, bytes) => sum + bytes.byteLength,
		0,
	);
	assert.ok(
		retainedBytes > 512 * 1024,
		'the retained output is large enough to outlast an ordinary settle',
	);
	service.adoptSession({
		identity,
		cwd: '/',
		createdAt: 1,
		cols: 120,
		rows: 24,
		process: heldProcess(retained),
		outputPosition: 0,
	});

	const journal = new OrderedEventJournal();
	const registry = createTerminalOperationRegistry({
		service,
		eventJournal: journal,
		checkpoints,
		allowUnresolvedTestSessions: true,
	});
	const pair = createInMemoryTransportPair();
	const connection = createServerCore({
		serverId: SERVER_ID,
		serverVersion: 'test',
		capabilities: ['terminal'],
		authenticate: ({ hello }) => ({
			clientId: hello.clientId,
			authScope: 'write',
		}),
		eventJournal: journal,
		...registry.operations,
		onConnectionClosed: (connectionId) =>
			registry.closeConnection(connectionId),
	}).accept(pair.server);
	const task = connection.start().catch(() => undefined);
	const client = new TerminayClient({
		transport: pair.client,
		clientId: 'device-web',
		capabilities: ['terminal', 'events.resync'],
	});
	const facade = new TerminayClientFacade(client);
	const terminal = new TerminayTerminalClient({
		command: facade.command.bind(facade),
		subscribe: client.subscribe.bind(client),
		queryWithBody: client.queryWithBody.bind(client),
	});
	await pair.open();
	await client.connect();
	try {
		// The window attaches straight away, as it does when the app reopens.
		const attachment = await terminal.attach({
			...identity,
			clientId: 'device-web',
			fromPosition: 0,
			freshPresentation: true,
		});
		const skips = attachment.initialEvents.filter(
			(event) => event.type === 'skip',
		);
		assert.deepEqual(skips, [], 'nothing the holder retained is skipped');
		const painted = attachment.initialEvents
			.filter((event) => event.type === 'checkpoint' || event.type === 'output')
			.map((event) => new TextDecoder().decode(event.bytes))
			.join('');
		assert.match(
			painted,
			/current-screen-marker/u,
			'the hydrated screen is the one the session was left on',
		);
	} finally {
		await client.close?.();
		await connection.close?.();
		await task;
		await service.stop?.();
	}
});
