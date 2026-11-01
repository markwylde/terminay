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

test('standalone clients can discover Pixel, enable it, and read its state without an agent', {
	timeout: 30000,
}, async () => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-standalone-pixel-'));
	let child, client;
	try {
		child = spawn(
			process.execPath,
			[
				'dist/cli.js',
				'start',
				'--server-id',
				'pixel-test',
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
		assert.equal(ready.ready, true);
		const token = new URLSearchParams(
			new URL(ready.pairing.pairingUrl).hash.slice(1),
		).get('pairingToken');
		assert.ok(token);
		client = new TerminayClient({
			transport: new WebSocketByteTransport({
				origin: ready.protocolEndpoint,
				authToken: token,
				WebSocket,
			}),
			clientId: 'pixel-test',
			reconnect: false,
		});
		const hello = await client.connect();
		assert.ok(hello.capabilities.includes('agent-chat.v1'));
		const facade = new TerminayClientFacade(client);
		assert.deepEqual(await facade.query('pixel.state'), {
			enabled: false,
			provider: 'unset',
		});
		await facade.command('settings.update', {
			settings: { pixel: { enabled: true, provider: 'unset' } },
		});
		assert.deepEqual(await facade.query('pixel.state'), {
			enabled: true,
			provider: 'unset',
		});
		assert.ok(
			Array.isArray((await facade.query('agent-chat.providers')).providers),
		);
	} finally {
		await client?.close();
		if (child?.exitCode === null) {
			child.kill('SIGTERM');
			await once(child, 'exit');
		}
		await rm(root, { recursive: true, force: true });
	}
});
