import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';

const { CONTROL_MAX_LARGE_FRAME_BYTES, CONTROL_TOOL_OPERATIONS, ControlFrameDecoder, encodeControlMessage } =
	await import('../dist/index.js');

const DRAW = {
	name: 'diagrams__draw',
	description: 'Draw a diagram',
	inputSchema: { type: 'object', properties: { shape: { type: 'string' } } },
};

/** A stand-in for the server's control socket. `respond` returns a result, or
 * `undefined` to leave the request held. */
async function withAdapter(respond, run) {
	const root = await mkdtemp(join(tmpdir(), 'terminay-stdio-windows-'));
	const socketPath = join(root, 'control.sock');
	const requests = [];
	const held = [];
	const control = createServer((socket) => {
		const decoder = new ControlFrameDecoder(CONTROL_MAX_LARGE_FRAME_BYTES);
		socket.on('error', () => {});
		socket.on('data', (chunk) => {
			for (const request of decoder.push(chunk)) {
				assert.equal(request.token, 'test-token');
				requests.push(request);
				const reply = respond(request);
				if (reply === undefined) {
					held.push((result) => socket.write(encodeControlMessage({ id: request.id, ok: true, result })));
					continue;
				}
				socket.write(encodeControlMessage({ id: request.id, ...reply }));
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
	const client = new Client({ name: 'stdio-app-windows-test', version: '1.0.0' });
	try {
		await client.connect(transport);
		await run({ client, requests, held });
	} finally {
		await client.close().catch(() => {});
		await new Promise((resolve) => control.close(resolve));
	}
}

const ok = (result, extra = {}) => ({ ok: true, result, ...extra });
const text = (result) => result.content.map((item) => item.text);

test("Terminay's own tools come first and in a fixed order, followed by connected tools", async () => {
	await withAdapter(
		(request) => (request.op === 'list_connected_tools' ? ok({ tools: [DRAW] }) : ok({})),
		async ({ client }) => {
			const { tools } = await client.listTools();
			const names = tools.map((tool) => tool.name);
			assert.deepEqual(names.slice(0, CONTROL_TOOL_OPERATIONS.length), [...CONTROL_TOOL_OPERATIONS]);
			assert.deepEqual(names.slice(CONTROL_TOOL_OPERATIONS.length), ['diagrams__draw']);
			const draw = tools.at(-1);
			assert.equal(draw.description, 'Draw a diagram');
			assert.deepEqual(draw.inputSchema, DRAW.inputSchema);
			// The internal operations that carry connected tools are never tools.
			assert.equal(names.includes('list_connected_tools'), false);
			assert.equal(names.includes('call_connected_tool'), false);
		},
	);
});

test('show_window tells the agent how to build a window and hear back from it', async () => {
	await withAdapter(
		(request) => (request.op === 'list_connected_tools' ? ok({ tools: [] }) : ok({})),
		async ({ client }) => {
			const { tools } = await client.listTools();
			const show = tools.find((tool) => tool.name === 'show_window');
			assert.match(show.description, /https/);
			assert.match(show.description, /window\.terminay\.sendMessage/);
			assert.deepEqual(show.inputSchema.required.sort(), ['html', 'title']);
			assert.ok(tools.some((tool) => tool.name === 'close_window'));
			assert.ok(tools.find((tool) => tool.name === 'list_windows').annotations.readOnlyHint);
		},
	);
});

test('show_window carries a large document and returns the handle; an oversized one never leaves the adapter', async () => {
	await withAdapter(
		(request) =>
			request.op === 'show_window' ? ok({ window: 'win_1', title: request.params.title, state: 'open' }) : ok({ tools: [] }),
		async ({ client, requests }) => {
			const html = `<h1>Hello</h1>${'x'.repeat(200 * 1024)}`;
			const shown = await client.callTool({ name: 'show_window', arguments: { title: 'Hello', html } });
			assert.equal(shown.isError, undefined);
			assert.match(text(shown)[0], /^show_window ok\n/);
			assert.match(text(shown)[0], /"window":"win_1"/);
			const sent = requests.find((request) => request.op === 'show_window');
			assert.equal(sent.params.html.length, html.length);
			const before = requests.length;
			const refused = await client.callTool({ name: 'show_window', arguments: { title: 'Big', html: 'x'.repeat(512 * 1024 + 1) } });
			assert.equal(refused.isError, true);
			assert.equal(requests.length, before);
			const blank = await client.callTool({ name: 'show_window', arguments: { title: '   ', html: '<p>x</p>' } });
			assert.equal(blank.isError, true);
			assert.equal(requests.length, before);
		},
	);
});

test('model context from a window is appended to the next tool result as its own block', async () => {
	await withAdapter(
		(request) =>
			request.op === 'list_windows'
				? ok({ windows: [] }, { modelContext: 'Context from the open window "Picker":\nselection: blue' })
				: ok({ tools: [] }),
		async ({ client }) => {
			const result = await client.callTool({ name: 'list_windows', arguments: {} });
			assert.deepEqual(text(result), ['list_windows ok\n{"windows":[]}', 'Context from the open window "Picker":\nselection: blue']);
		},
	);
});

test("a connected tool is forwarded with its arguments and its result is returned as the server's own", async () => {
	await withAdapter(
		(request) => {
			if (request.op === 'list_connected_tools') return ok({ tools: [DRAW] });
			if (request.op === 'call_connected_tool')
				return ok(
					{ content: [{ type: 'text', text: 'drawn' }], structuredContent: { shapes: 1 } },
					{ modelContext: 'note for the model' },
				);
			return ok({});
		},
		async ({ client, requests }) => {
			const result = await client.callTool({ name: 'diagrams__draw', arguments: { shape: 'circle' } });
			assert.deepEqual(result.content, [
				{ type: 'text', text: 'drawn' },
				{ type: 'text', text: 'note for the model' },
			]);
			assert.deepEqual(result.structuredContent, { shapes: 1 });
			const sent = requests.find((request) => request.op === 'call_connected_tool');
			assert.deepEqual(sent.params, { name: 'diagrams__draw', arguments: { shape: 'circle' } });
		},
	);
});

test('a refused connected tool reports the control error to the agent', async () => {
	await withAdapter(
		(request) =>
			request.op === 'call_connected_tool'
				? { ok: false, error: { code: 'permission_denied', message: 'Connected Server Tools is set to Never Allow.' } }
				: ok({ tools: [DRAW] }),
		async ({ client }) => {
			const result = await client.callTool({ name: 'diagrams__draw', arguments: {} });
			assert.equal(result.isError, true);
			assert.match(text(result)[0], /^permission_denied: /);
		},
	);
});

test("when connected servers cannot be listed, Terminay's own tools are still offered", async () => {
	await withAdapter(
		(request) =>
			request.op === 'list_connected_tools'
				? { ok: false, error: { code: 'unsupported_op', message: 'control operation list_connected_tools is unavailable' } }
				: ok({}),
		async ({ client }) => {
			const { tools } = await client.listTools();
			assert.deepEqual(tools.map((tool) => tool.name), [...CONTROL_TOOL_OPERATIONS]);
		},
	);
});

test('malformed connected tool entries are dropped rather than offered', async () => {
	await withAdapter(
		(request) =>
			request.op === 'list_connected_tools'
				? ok({ tools: [DRAW, { name: 'no separator', inputSchema: {} }, { name: 'diagrams__nope' }, 'junk', { name: 'show_window', inputSchema: {} }] })
				: ok({}),
		async ({ client }) => {
			const { tools } = await client.listTools();
			assert.deepEqual(tools.map((tool) => tool.name).slice(CONTROL_TOOL_OPERATIONS.length), ['diagrams__draw']);
		},
	);
});

test('the agent is told when the set of connected tools changes, through one held request per change', async () => {
	let tools = [];
	let revision = 'rev-1';
	await withAdapter(
		(request) => {
			if (request.op !== 'list_connected_tools') return ok({});
			// A held watch: answer only once the revision differs.
			if (request.params.after === revision) return undefined;
			return ok({ tools, revision });
		},
		async ({ client, requests, held }) => {
			let notified = 0;
			client.setNotificationHandler(ToolListChangedNotificationSchema, () => { notified += 1; });
			await waitFor(() => held.length === 1);
			assert.equal(notified, 0);
			assert.equal(requests.filter((request) => request.params.after === 'rev-1').length, 1);
			tools = [DRAW];
			revision = 'rev-2';
			held.shift()({ tools, revision });
			await waitFor(() => notified === 1);
			assert.deepEqual((await client.listTools()).tools.at(-1).name, 'diagrams__draw');
			// It re-arms with the new revision and does not spin.
			await waitFor(() => held.length === 1);
			assert.equal(requests.filter((request) => request.params.after === 'rev-2').length, 1);
			assert.equal(notified, 1);
		},
	);
});

async function waitFor(condition, timeoutMs = 5000) {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error('condition was not met in time');
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}
