import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { MessageChannel } from 'node:worker_threads';
import { TerminayClient } from '@terminay/client-core';
import { createServerCore } from '@terminay/server-core';
import { build } from 'esbuild';
import { createProjectAcrossReconnects } from '../src/workspace/projectCreationRecovery.ts';

/**
 * A project asked for just after waking a laptop.
 *
 * The report (diagnostics launch c0f3d2eb, 2026-10-07T08:59:50Z..09:00:07Z):
 * the machine slept for ten minutes, the server read that as ten minutes of
 * client silence and closed the embedded connection on wake, the window did
 * not learn of the close for 17 seconds, and a project created in that gap
 * ended as `command outcome is unknown` on a tab that held the whole window.
 *
 * These run the real server core, client, and port transport over a real
 * MessageChannel.
 */

const outputDirectory = await mkdtemp(
	join(process.cwd(), 'scripts', '.wake-reaped-renderer-connection-'),
);
const outputFile = join(outputDirectory, 'serverPortTransport.mjs');
await build({
	absWorkingDir: process.cwd(),
	bundle: true,
	entryPoints: ['src/shared/serverPortTransport.ts'],
	external: ['@terminay/protocol'],
	format: 'esm',
	outfile: outputFile,
	platform: 'node',
});
const { ServerPortTransport, ServerScopedMessagePort } = await import(
	outputFile
);
test.after(() => rm(outputDirectory, { recursive: true, force: true }));

const SERVER_ID = 'wake-server';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A server that owns projects, and a way for a window to connect to it. */
function createWorkspaceServer(options = {}) {
	const projects = new Set();
	const reaped = [];
	const created = [];
	/** Run inside the next creation, after it has been applied. */
	let afterCommit;
	const core = createServerCore({
		serverId: SERVER_ID,
		serverVersion: 'test',
		capabilities: [],
		authenticate: ({ hello }) => ({
			clientId: hello.clientId,
			authScope: 'admin',
		}),
		onConnectionClosed: (connectionId) => reaped.push(connectionId),
		queries: {
			'workspace.projects': () => ({ projects: [...projects] }),
		},
		commands: {
			'workspace.project.create': async (request) => {
				const { projectId } = request.envelope.payload;
				created.push(projectId);
				if (projects.has(projectId)) throw new Error('project already exists');
				projects.add(projectId);
				const hook = afterCommit;
				afterCommit = undefined;
				await hook?.();
				return { projectId };
			},
		},
		...options,
	});
	const channels = [];
	return {
		projects,
		reaped,
		created,
		onNextCommit(hook) {
			afterCommit = hook;
		},
		async connect() {
			const channel = new MessageChannel();
			channels.push(channel);
			const connection = core.accept(
				new ServerPortTransport(
					new ServerScopedMessagePort(channel.port1, SERVER_ID),
				),
			);
			const task = connection.start().catch(() => undefined);
			const transport = new ServerPortTransport(
				new ServerScopedMessagePort(channel.port2, SERVER_ID),
			);
			const client = new TerminayClient({
				transport,
				clientId: 'embedded-renderer',
				// connectionRegistry advertises this for every connection, the
				// embedded Local one included.
				capabilities: ['connection.heartbeat'],
			});
			await client.connect();
			return { client, connection, transport, task };
		},
		async dispose(sessions) {
			for (const session of sessions) {
				await session.client.close().catch(() => undefined);
				await session.connection.close().catch(() => undefined);
				await session.task;
			}
			for (const channel of channels) {
				channel.port1.close();
				channel.port2.close();
			}
		},
	};
}

test('a project created just after wake is created on the connection that slept', async () => {
	let sleptMs = 0;
	const server = createWorkspaceServer({
		// Production waits 60s; a ten-minute sleep overshoots either bound.
		heartbeatTimeoutMs: 60,
		heartbeatNow: () => Date.now() + sleptMs,
	});
	const session = await server.connect();
	try {
		// The lid closes: the window sends no probes, and the server's
		// deadline comes due while nothing is running to read one.
		sleptMs = 600_000;
		await wait(90);

		assert.deepEqual(server.reaped, [], 'sleep is not client silence');
		assert.equal(session.transport.state, 'open');

		// The lid opens and the person asks for a project straight away.
		const result = await session.client.command('workspace.project.create', {
			projectId: 'project-after-wake',
		});
		assert.equal(result.ok, true);
		assert.deepEqual([...server.projects], ['project-after-wake']);
	} finally {
		await server.dispose([session]);
	}
});

/** Drive one creation the way the workspace does, across reconnects. */
async function createAcrossReconnects(server, first, projectId) {
	const sessions = [first];
	let current = first;
	const sessionId = await createProjectAcrossReconnects({
		create: async () => {
			await current.client.command('workspace.project.create', { projectId });
		},
		launchTerminal: async () => 'session-1',
		resynchronise: async () => {
			current = await server.connect();
			sessions.push(current);
			const { result } = await current.client.query('workspace.projects');
			return { exists: result.projects.includes(projectId) };
		},
	});
	return { sessionId, sessions };
}

test('a creation whose connection the server closed first is sent again and yields one project', async () => {
	const server = createWorkspaceServer();
	const first = await server.connect();
	// The server ends the connection; the window is told nothing but that.
	await first.connection.close();

	const { sessions } = await createAcrossReconnects(server, first, 'project-1');

	assert.deepEqual(server.created, ['project-1'], 'the lost send never arrived');
	assert.deepEqual([...server.projects], ['project-1']);
	await server.dispose(sessions);
});

test('a creation the server applied before its connection closed is not sent again', async () => {
	const server = createWorkspaceServer();
	const first = await server.connect();
	// The project is created, and the connection dies before the reply.
	server.onNextCommit(() => first.connection.close());

	const { sessions } = await createAcrossReconnects(server, first, 'project-1');

	assert.deepEqual(server.created, ['project-1'], 'one send, applied once');
	assert.deepEqual([...server.projects], ['project-1']);
	await server.dispose(sessions);
});
