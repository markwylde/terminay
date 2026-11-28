import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { WebSocket } from 'ws';
import {
	TerminayClient,
	TerminayClientFacade,
	WebSocketByteTransport,
} from '@terminay/client-core';

test('a standalone server advertises the server desktop and answers its status, on any host', {
	timeout: 60000,
}, async () => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-standalone-desktop-'));
	let child, client, facade, status;
	try {
		child = spawn(
			process.execPath,
			[
				'dist/cli.js',
				'start',
				'--server-id',
				'desktop-test',
				'--data-root',
				join(root, 'data'),
				'--project-root',
				root,
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
				env: { ...process.env, HOME: root, TERMINAY_SERVER_VERSION: 'test' },
				stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
			},
		);
		child.stdio[3].end('test-vault-passphrase\n');
		let stderr = '';
		child.stderr.on('data', (bytes) => (stderr += bytes));
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
		const token = new URLSearchParams(
			new URL(ready.pairing.pairingUrl).hash.slice(1),
		).get('pairingToken');
		client = new TerminayClient({
			transport: new WebSocketByteTransport({
				origin: ready.protocolEndpoint,
				authToken: token,
				WebSocket,
			}),
			clientId: 'desktop-test',
			reconnect: false,
		});
		const hello = await client.connect();
		assert.ok(hello.capabilities.includes('server-desktop.v1'));
		facade = new TerminayClientFacade(client);
		status = (await facade.query('server.desktop.status', {})).status;
		// What the state is depends on the machine running the test; that the
		// server answers with one, and says why where it cannot offer a
		// desktop, does not.
		assert.ok(
			['unsupported', 'needs-setup', 'setting-up', 'ready', 'off', 'failed'].includes(
				status.state,
			),
			JSON.stringify(status),
		);
		if (status.state === 'unsupported') {
			assert.equal(typeof status.reason, 'string');
			assert.ok(status.message.length > 0);
		}
		if (status.state === 'needs-setup') {
			// This server has no way to install packages itself.
			assert.equal(status.setup, 'command');
			assert.equal(status.command, 'sudo terminay daemon desktop install');
			await assert.rejects(facade.command('server.desktop.setup', {}));
		}
		// Clients cannot steer the desktop with fields of their own.
		await assert.rejects(facade.command('server.desktop.enable', { display: 1 }));
	} finally {
		// On a machine that has the desktop programs, the server started a
		// desktop: end it rather than leave it behind this test.
		if (facade && status && ['ready', 'setting-up', 'failed'].includes(status.state))
			await facade
				.command('server.desktop.disable', { confirmed: true })
				.catch(() => undefined);
		await client?.close();
		if (child?.exitCode === null) {
			child.kill('SIGTERM');
			await once(child, 'exit');
		}
		await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
});
