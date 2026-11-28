import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	TerminayClient,
	TerminayClientFacade,
	WebSocketByteTransport,
} from '@terminay/client-core';
import { WebSocket } from 'ws';

// A real standalone server whose data root stops accepting writes: the client
// is told so, in words naming the data folder (ADR-0150).

async function startServer(root) {
	const child = spawn(
		process.execPath,
		[
			'dist/cli.js',
			'start',
			'--server-id',
			'storage-failure-test',
			'--data-root',
			join(root, 'data'),
			'--project-root',
			join(root, 'default'),
			'--http-host',
			'127.0.0.1',
			'--http-port',
			'0',
			'--remote-origin',
			'http://127.0.0.1:9123',
			'--expose',
			'off',
			'--vault-unlock-fd',
			'3',
		],
		{
			cwd: new URL('../', import.meta.url),
			// Do not inherit the running host's listeners, control socket or data
			// paths. This child owns only its temporary server state.
			env: {
				...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('TERMINAY_'))),
				HOME: root,
				TERMINAY_SERVER_VERSION: 'test',
			},
			stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
		},
	);
	// The child may close its end once it has read the passphrase.
	child.stdio[3].on('error', () => undefined);
	child.stdio[3].end('test-vault-passphrase\n');
	let stderr = '';
	child.stderr.on('data', (bytes) => (stderr += bytes));
	const stop = async () => {
		if (child.exitCode === null) {
			child.kill('SIGTERM');
			await once(child, 'exit');
		}
	};
	try {
		const ready = await new Promise((resolve, reject) => {
			let output = '';
			child.stdout.on('data', (bytes) => {
				output += bytes;
				const end = output.indexOf('\n');
				if (end >= 0) {
					try {
						resolve(JSON.parse(output.slice(0, end)));
					} catch (error) {
						reject(error);
					}
				}
			});
			child.once('error', reject);
			child.once('exit', () =>
				reject(new Error(`CLI exited before readiness: ${stderr}`)),
			);
		});
		assert.equal(ready.ready, true);
		const token = new URLSearchParams(
			new URL(ready.pairing.pairingUrl).hash.slice(1),
		).get('pairingToken');
		assert.ok(token);
		const client = new TerminayClient({
			transport: new WebSocketByteTransport({
				origin: ready.protocolEndpoint,
				authToken: token,
				WebSocket,
			}),
			clientId: 'storage-failure-test',
			capabilities: ['project-start-choice.v1'],
			reconnect: false,
		});
		await client.connect();
		return {
			facade: new TerminayClientFacade(client),
			async stop() {
				await client.close().catch(() => undefined);
				await stop();
			},
		};
	} catch (error) {
		await stop();
		throw error;
	}
}

async function createProject(facade, projectId) {
	const snapshot = await facade.query('workspace.snapshot');
	await facade.command('workspace.command', {
		command: {
			type: 'project.create',
			projectId,
			viewId: snapshot.viewOrder[0],
			name: projectId,
		},
	});
}

test('a write the data root refuses is named to the client', {
	timeout: 90000,
	// Permissions do not refuse root, and Windows ignores the mode.
	skip: process.platform === 'win32' || process.getuid?.() === 0,
}, async () => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-storage-failure-'));
	const data = join(root, 'data');
	let server;
	try {
		await mkdir(join(root, 'default'));
		server = await startServer(root);
		await chmod(data, 0o500);
		await assert.rejects(
			createProject(server.facade, 'project-refused'),
			(error) => {
				assert.equal(
					error.message,
					'The server does not have permission to access its data folder',
				);
				assert.equal(error.cause.details.reason, 'storage_permission');
				assert.equal(error.cause.retryable, false);
				return true;
			},
		);
		const snapshot = await server.facade.query('workspace.snapshot');
		assert.equal(snapshot.projects['project-refused'], undefined);
		await chmod(data, 0o700);
		await createProject(server.facade, 'project-accepted');
	} finally {
		await chmod(data, 0o700).catch(() => undefined);
		await server?.stop();
		await rm(root, { recursive: true, force: true });
	}
});
