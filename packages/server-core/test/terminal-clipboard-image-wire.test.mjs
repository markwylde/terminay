/**
 * Clipboard image upload over a real client/server connection.
 *
 * The unit tests either side of the wire both pass against hand-written
 * doubles, so they cannot see a client that calls a transport method without
 * its receiver, or a server that never receives the framed body. Drive the
 * genuine TerminayClient transport against the genuine terminal operation
 * registry so the browser paste path is covered end to end.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { TerminayClient, TerminayTerminalClient } from '@terminay/client-core';
import { createInMemoryTransportPair } from '@terminay/protocol-conformance';
import {
	createTerminalOperationRegistry,
	OrderedEventJournal,
	ServerConnection,
	TerminalService,
} from '../dist/index.js';

const PNG = Uint8Array.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x11, 0x22,
]);

function createPtyFactory() {
	return {
		spawn(options) {
			return {
				pid: 9100,
				options,
				write() {},
				resize() {},
				kill() {},
				onData() {
					return () => {};
				},
				onExit() {
					return () => {};
				},
			};
		},
	};
}

async function withConnectedTerminalClient(run) {
	const directory = await mkdtemp(join(tmpdir(), 'terminay-clipboard-wire-'));
	const service = new TerminalService({
		serverId: 'server-a',
		ptyFactory: createPtyFactory(),
		generateSessionId: () => 'session-a',
	});
	const session = await service.createSession({
		projectId: 'project-a',
		cols: 80,
		rows: 24,
	});
	const registry = createTerminalOperationRegistry({
		service,
		eventJournal: new OrderedEventJournal(),
		allowUnresolvedTestSessions: true,
		clipboardScratchDirectory: directory,
	});
	const pair = createInMemoryTransportPair();
	await pair.open();
	const server = new ServerConnection(pair.server, {
		serverId: 'server-a',
		serverVersion: 'test',
		capabilities: ['terminal'],
		authenticate: ({ hello }) => ({
			clientId: hello.clientId,
			authScope: 'write',
		}),
		commands: registry.operations.commands,
		queries: registry.operations.queries,
	});
	const serverTask = server.start();
	const client = new TerminayClient({
		transport: pair.client,
		clientId: 'client-a',
		capabilities: ['terminal'],
	});
	try {
		await client.connect();
		return await run({
			terminals: new TerminayTerminalClient(client),
			identity: {
				serverId: 'server-a',
				projectId: 'project-a',
				sessionId: session.sessionId,
			},
			directory,
		});
	} finally {
		await client.close().catch(() => undefined);
		await serverTask.catch(() => undefined);
		await rm(directory, { recursive: true, force: true });
	}
}

test('a browser clipboard image reaches server scratch over a real connection', async () => {
	await withConnectedTerminalClient(
		async ({ terminals, identity, directory }) => {
			const path = await terminals.materializeClipboardImage({
				identity,
				mimeType: 'image/png',
				bytes: PNG,
			});
			assert.equal(path.startsWith(directory), true);
			assert.match(path, /clipboard-[0-9a-f-]+\.png$/u);
			assert.deepEqual(Uint8Array.from(await readFile(path)), PNG);
		},
	);
});

test('a rejected clipboard image surfaces the server refusal to the caller', async () => {
	await withConnectedTerminalClient(async ({ terminals, identity }) => {
		await assert.rejects(() =>
			terminals.materializeClipboardImage({
				identity,
				mimeType: 'image/png',
				bytes: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]),
			}),
		);
	});
});
