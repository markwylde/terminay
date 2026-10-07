import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
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
			assert.match(show.description, /html_file/);
			assert.match(show.description, /sendMessage\("text", \{ files \}\)/);
			assert.match(show.description, /Attached: <path>/);
			assert.match(show.description, /window\.terminay\.data/);
			// The document comes inline or from a file, so neither is required by the schema.
			assert.deepEqual(show.inputSchema.required, ['title']);
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

test('show_window reads html_file in the adapter and sends the document, never the path', async () => {
	await withAdapter(
		(request) =>
			request.op === 'show_window' ? ok({ window: 'win_1', title: request.params.title, state: 'open' }) : ok({ tools: [] }),
		async ({ client, requests }) => {
			const root = await mkdtemp(join(tmpdir(), 'terminay-window-document-'));
			const file = join(root, 'questionnaire.html');
			const html = '<!doctype html><h1>Questions</h1><script>document.title = window.terminay.data.questions.length</script>';
			await writeFile(file, html);
			const data = { questions: ['Ship it?', 'Twice?'] };
			const shown = await client.callTool({ name: 'show_window', arguments: { title: 'Questions', html_file: file, data } });
			assert.equal(shown.isError, undefined);
			assert.match(text(shown)[0], /"window":"win_1"/);
			// The document is shown to the user; it is not handed back to the agent.
			assert.ok(!text(shown).join('\n').includes('Questions</h1>'));
			const sent = requests.find((request) => request.op === 'show_window');
			assert.equal(sent.params.html, html);
			assert.deepEqual(sent.params.data, data);
			assert.equal('html_file' in sent.params, false);
			assert.ok(!JSON.stringify(sent).includes(root));
		},
	);
});

test('show_window refuses a document it cannot read as one, before anything reaches the server', async () => {
	await withAdapter(
		(request) => (request.op === 'show_window' ? ok({ window: 'win_1', title: 'x', state: 'open' }) : ok({ tools: [] })),
		async ({ client, requests }) => {
			const root = await mkdtemp(join(tmpdir(), 'terminay-window-document-'));
			const secret = join(root, 'secret.html');
			await writeFile(secret, 'TOP-SECRET-CONTENTS');
			const big = join(root, 'big.html');
			await writeFile(big, 'x'.repeat(512 * 1024 + 1));
			const binary = join(root, 'binary.html');
			await writeFile(binary, Buffer.from([0x3c, 0x70, 0x3e, 0xff, 0xfe, 0xc3]));
			const empty = join(root, 'empty.html');
			await writeFile(empty, '');
			const directory = join(root, 'directory');
			await mkdir(directory);
			// A pipe nobody writes to: reading it would wait for ever.
			const pipe = join(root, 'pipe.html');
			execFileSync('mkfifo', [pipe]);
			const show = (args) => client.callTool({ name: 'show_window', arguments: { title: 'x', ...args } });
			const cases = [
				[{ html: '<p>x</p>', html_file: secret }, /^bad_request: give exactly one/],
				[{}, /^bad_request: give exactly one/],
				[{ html_file: 'relative/page.html' }, /^bad_request: html_file must be an absolute path/],
				[{ html_file: join(root, 'missing.html') }, /^not_found: html_file does not exist/],
				[{ html_file: directory }, /^bad_request: html_file must be a regular file/],
				[{ html_file: '/dev/null' }, /^bad_request: html_file must be a regular file/],
				[{ html_file: pipe }, /^bad_request: html_file must be a regular file/],
				[{ html_file: big }, /^bad_request: html_file must be at most 512 KiB/],
				[{ html_file: binary }, /^bad_request: html_file must be UTF-8 text/],
				[{ html_file: empty }, /^bad_request: html_file is empty/],
			];
			for (const [args, expected] of cases) {
				const refused = await show(args);
				assert.equal(refused.isError, true, JSON.stringify(args));
				assert.match(text(refused)[0], expected);
				assert.ok(!text(refused).join('\n').includes('TOP-SECRET-CONTENTS'));
			}
			// Data too large for a window never leaves the adapter either.
			const oversized = await show({ html: '<p>x</p>', data: { text: 'd'.repeat(64 * 1024) } });
			assert.equal(oversized.isError, true);
			assert.equal(requests.filter((request) => request.op === 'show_window').length, 0);
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
