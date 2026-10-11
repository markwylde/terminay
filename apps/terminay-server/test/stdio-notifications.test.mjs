import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const { ControlFrameDecoder, encodeControlMessage } = await import('../dist/index.js');

/** A stand-in for the server's control socket. */
async function withAdapter(respond, run) {
	const root = await mkdtemp(join(tmpdir(), 'terminay-stdio-notifications-'));
	const socketPath = join(root, 'control.sock');
	const requests = [];
	const control = createServer((socket) => {
		const decoder = new ControlFrameDecoder();
		socket.on('error', () => {});
		socket.on('data', (chunk) => {
			for (const request of decoder.push(chunk)) {
				assert.equal(request.token, 'test-token');
				requests.push(request);
				socket.write(encodeControlMessage({ id: request.id, ...respond(request) }));
			}
		});
	});
	await new Promise((resolve) => control.listen(socketPath, resolve));
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [fileURLToPath(new URL('../dist/mcpEntry.js', import.meta.url))],
		env: { ...process.env, TERMINAY_CONTROL_SOCKET: socketPath, TERMINAY_CONTROL_TOKEN: 'test-token' },
		stderr: 'pipe',
	});
	const client = new Client({ name: 'stdio-notifications-test', version: '1.0.0' });
	try {
		await client.connect(transport);
		await run({ client, requests });
	} finally {
		await client.close().catch(() => {});
		await new Promise((resolve) => control.close(resolve));
	}
}

const ok = (result) => ({ ok: true, result });
const text = (result) => result.content.map((item) => item.text);

test('the notification tools tell the agent when a notification is and is not shown', async () => {
	await withAdapter(
		(request) => (request.op === 'list_connected_tools' ? ok({ tools: [] }) : ok({})),
		async ({ client }) => {
			const { tools } = await client.listTools();
			const send = tools.find((tool) => tool.name === 'send_notification');
			const dismiss = tools.find((tool) => tool.name === 'dismiss_notification');
			for (const tool of [send, dismiss]) {
				assert.match(tool.description, /shown to the user only if it is still present after a short settle period of about five seconds/);
				assert.match(tool.description, /removed when the user interacts with this terminal/);
				assert.match(tool.description, /by clicking or typing in it, including within that period/);
				// The same approval note the other gated tools carry.
				assert.match(tool.description, /Settings > AI > Terminay MCP/);
				assert.match(tool.description, /permission_declined/);
				assert.match(tool.description, /permission_denied/);
			}
			assert.deepEqual(send.inputSchema.required, ['body']);
			assert.deepEqual(Object.keys(send.inputSchema.properties).sort(), ['body', 'notification', 'title']);
			assert.deepEqual(dismiss.inputSchema.required, ['notification']);
			// No parameter names a terminal or a project.
			assert.deepEqual(Object.keys(dismiss.inputSchema.properties), ['notification']);
		},
	);
});

test('send_notification and dismiss_notification are forwarded as given and return the handle', async () => {
	await withAdapter(
		(request) => {
			if (request.op === 'send_notification') return ok({ notification: 'n-1', sent: 'held' });
			if (request.op === 'dismiss_notification') return ok({ notification: request.params.notification, dismissed: true });
			return ok({ tools: [] });
		},
		async ({ client, requests }) => {
			const sent = await client.callTool({ name: 'send_notification', arguments: { title: 'Review ready', body: 'Three files changed' } });
			assert.equal(sent.isError, undefined);
			assert.match(text(sent)[0], /^send_notification ok\n/);
			assert.match(text(sent)[0], /"notification":"n-1"/);
			assert.deepEqual(requests.find((request) => request.op === 'send_notification').params, { title: 'Review ready', body: 'Three files changed' });
			const replaced = await client.callTool({ name: 'send_notification', arguments: { body: 'Four files changed', notification: 'n-1' } });
			assert.equal(replaced.isError, undefined);
			assert.deepEqual(requests.filter((request) => request.op === 'send_notification')[1].params, { body: 'Four files changed', notification: 'n-1' });
			const dismissed = await client.callTool({ name: 'dismiss_notification', arguments: { notification: 'n-1' } });
			assert.match(text(dismissed)[0], /"dismissed":true/);
			// Text over the bounds never leaves the adapter.
			const before = requests.length;
			for (const args of [{ body: 'b'.repeat(281) }, { body: 'ok', title: 't'.repeat(81) }, { body: '   ' }, { title: 'No body' }]) {
				const refused = await client.callTool({ name: 'send_notification', arguments: args });
				assert.equal(refused.isError, true, JSON.stringify(args));
			}
			assert.equal(requests.length, before);
		},
	);
});

test('a refused notification reports the control error to the agent', async () => {
	await withAdapter(
		(request) =>
			request.op === 'send_notification'
				? { ok: false, error: { code: 'permission_denied', message: 'Notifications is set to Never Allow for Terminay MCP.' } }
				: request.op === 'dismiss_notification'
					? { ok: false, error: { code: 'not_found', message: 'This terminal sent no notification with that handle.' } }
					: ok({ tools: [] }),
		async ({ client }) => {
			const denied = await client.callTool({ name: 'send_notification', arguments: { body: 'Hello' } });
			assert.equal(denied.isError, true);
			assert.match(text(denied)[0], /^permission_denied: /);
			const missing = await client.callTool({ name: 'dismiss_notification', arguments: { notification: 'n-9' } });
			assert.equal(missing.isError, true);
			assert.match(text(missing)[0], /^not_found: /);
		},
	);
});
