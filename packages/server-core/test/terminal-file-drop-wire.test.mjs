/**
 * Terminal file drops over a real client/server connection (ADR-0113): the
 * genuine TerminayTerminalClient streaming parts to the genuine terminal
 * operation registry, so framing, ownership and cleanup are all exercised.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { TerminayClient, TerminayTerminalClient } from '@terminay/client-core';
import { createInMemoryTransportPair } from '@terminay/protocol-conformance';
import {
	createTerminalOperationRegistry,
	OrderedEventJournal,
	ServerConnection,
	TerminalService,
	uniqueDropName,
} from '../dist/index.js';

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
	const directory = await mkdtemp(join(tmpdir(), 'terminay-drop-wire-'));
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
		fileDropDirectory: directory,
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


function reader(contents) {
	return async (file, offset, length) =>
		contents[file].subarray(offset, offset + length);
}

test('dropped files stream into one server-owned folder and keep their names', async () => {
	await withConnectedTerminalClient(async ({ terminals, identity, directory }) => {
		// Larger than one 1 MiB part, so the file arrives in several.
		const big = new Uint8Array(2.5 * 1024 * 1024).map((_, index) => index % 251);
		const small = new TextEncoder().encode('hello');
		const progress = [];
		const paths = await terminals.uploadDroppedFiles(
			identity,
			[
				{ name: 'shot one.png', size: big.byteLength },
				{ name: 'notes.txt', size: small.byteLength },
				{ name: 'empty', size: 0 },
			],
			reader([big, small, new Uint8Array()]),
			{ onProgress: (sent, total) => progress.push([sent, total]) },
		);
		assert.equal(paths.length, 3);
		const folder = dirname(paths[0]);
		assert.equal(dirname(folder), directory);
		assert.deepEqual(paths.map((path) => dirname(path)), [folder, folder, folder]);
		assert.deepEqual(paths.map((path) => basename(path)), ['shot_one.png', 'notes.txt', 'empty']);
		assert.deepEqual(Uint8Array.from(await readFile(paths[0])), big);
		assert.equal(await readFile(paths[1], 'utf8'), 'hello');
		assert.equal((await stat(paths[2])).size, 0);
		assert.equal((await stat(folder)).mode & 0o777, 0o700);
		assert.deepEqual(progress.at(-1), [big.byteLength + 5, big.byteLength + 5]);
		assert.ok(progress.length >= 4);
	});
});

test('an aborted drop removes everything it wrote', async () => {
	await withConnectedTerminalClient(async ({ terminals, identity, directory }) => {
		const big = new Uint8Array(3 * 1024 * 1024);
		const controller = new AbortController();
		await assert.rejects(() =>
			terminals.uploadDroppedFiles(
				identity,
				[{ name: 'video.mov', size: big.byteLength }],
				reader([big]),
				{
					signal: controller.signal,
					onProgress: () => controller.abort(),
				},
			),
		);
		// Cancel is sent best effort after the rejection; give it a turn to land.
		for (let attempt = 0; attempt < 50; attempt += 1) {
			if ((await readdir(directory)).length === 0) break;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		assert.deepEqual(await readdir(directory), []);
	});
});

test('a file that grows while it is read is refused and removed', async () => {
	await withConnectedTerminalClient(async ({ terminals, identity, directory }) => {
		await assert.rejects(
			() =>
				terminals.uploadDroppedFiles(
					identity,
					[{ name: 'log.txt', size: 3 }],
					async () => new TextEncoder().encode('more than three'),
				),
			/changed while it was being read/,
		);
		assert.deepEqual(await readdir(directory), []);
	});
});

test('a drop for a session that does not exist is refused before any byte', async () => {
	await withConnectedTerminalClient(async ({ terminals, identity, directory }) => {
		await assert.rejects(() =>
			terminals.uploadDroppedFiles(
				{ ...identity, sessionId: 'session-missing' },
				[{ name: 'a.txt', size: 1 }],
				reader([Uint8Array.of(1)]),
			),
		);
		assert.deepEqual(await readdir(directory).catch(() => []), []);
	});
});

test('names that collide within one drop are made unique, ignoring case', () => {
	const taken = new Set();
	assert.deepEqual(
		['a.txt', 'A.txt', 'a.txt', 'README'].map((name) => uniqueDropName(name, taken)),
		['a.txt', 'A-2.txt', 'a-3.txt', 'README'],
	);
});
