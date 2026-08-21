import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
	ControlFrameDecoder,
	encodeControlMessage,
} from '../dist/mcp/controlEndpoint.js';
import { runServerMcpStdio } from '../dist/mcp/stdio.js';

const expectedTools = [
	'close_terminal',
	'focus_terminal',
	'get_terminal_status',
	'list_terminals',
	'open_terminal',
	'read_terminal',
	'rename_terminal',
	'run_command',
	'split_terminal',
	'wait_for_attention',
	'wait_for_command',
	'wait_for_idle',
	'write_terminal',
];

test('headless MCP rejects non-local sockets and malformed inherited capabilities', async () => {
	await assert.rejects(
		runServerMcpStdio({ socketPath: 'tcp://127.0.0.1:1', token: 'token' }),
		/absolute local control socket/,
	);
	await assert.rejects(
		runServerMcpStdio({
			socketPath: '/tmp/terminay-control.sock',
			token: 'bad\n token',
		}),
		/inherited terminal capability/,
	);
});

test('server-owned MCP stdio entry registers tools and uses the local control socket', async () => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-server-mcp-'));
	const socketPath = join(root, 'control.sock');
	const receivedOperations = [];
	const control = createServer((socket) => {
		const decoder = new ControlFrameDecoder();
		socket.on('data', (chunk) => {
			for (const request of decoder.push(chunk)) {
				receivedOperations.push(request.op);
				assert.equal(request.token, 'test-token');
				if (request.op === 'read_terminal') {
					socket.write(
						encodeControlMessage({
							id: request.id,
							ok: false,
							error: {
								code: 'terminal_not_found',
								message: 'terminal is no longer live',
								candidates: ['sibling'],
							},
						}),
					);
					continue;
				}
				socket.write(
					encodeControlMessage({
						id: request.id,
						ok: true,
						result:
							request.op === 'list_terminals'
								? { terminals: [{ id: 'sibling', busy: false }] }
								: { ok: true },
					}),
				);
			}
	});
});
	await new Promise((resolve) => control.listen(socketPath, resolve));
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [fileURLToPath(new URL('../dist/mcpEntry.js', import.meta.url))],
		env: {
			...process.env,
			TERMINAY_CONTROL_SOCKET: socketPath,
			TERMINAY_CONTROL_TOKEN: 'test-token',
		},
		stderr: 'pipe',
	});
	const client = new Client({ name: 'server-mcp-test', version: '1.0.0' });
	try {
		await client.connect(transport);
		const tools = await client.listTools();
		assert.deepEqual(
			tools.tools.map((tool) => tool.name).sort(),
			[...expectedTools].sort(),
		);
		const readSchema = tools.tools.find(
			(tool) => tool.name === 'read_terminal',
		)?.inputSchema;
		const listTool = tools.tools.find(
			(tool) => tool.name === 'list_terminals',
		);
		assert.deepEqual(listTool?.annotations, {
			readOnlyHint: true,
			destructiveHint: false,
			openWorldHint: false,
		});
		assert.equal(readSchema?.properties?.lines?.maximum, 4096);
		const writeSchema = tools.tools.find(
			(tool) => tool.name === 'write_terminal',
		)?.inputSchema;
		assert.equal(writeSchema?.properties?.text?.maxLength, 65536);
		const result = await client.callTool({
			name: 'list_terminals',
			arguments: {},
		});
		assert.notEqual(result.isError, true, JSON.stringify(result));
		assert.match(
			result.content.find((item) => item.type === 'text')?.text ?? '',
			/sibling/,
		);
		const waited = await client.callTool({
			name: 'wait_for_idle',
			arguments: { terminal: 'sibling', seconds: 0 },
		});
		assert.notEqual(waited.isError, true, JSON.stringify(waited));
		const typedFailure = await client.callTool({
			name: 'read_terminal',
			arguments: { terminal: 'sibling' },
		});
		assert.equal(typedFailure.isError, true);
		assert.equal(
			typedFailure.structuredContent?.error?.code,
			'terminal_not_found',
		);
		assert.match(
			typedFailure.content.find((item) => item.type === 'text')?.text ?? '',
			/^terminal_not_found:/,
		);
		const invalidArguments = await client.callTool({
			name: 'get_terminal_status',
			arguments: { terminal: '' },
		});
		assert.equal(invalidArguments.isError, true);
		assert.match(
			invalidArguments.content.find((item) => item.type === 'text')?.text ?? '',
			/Input validation error/,
		);
		const oversizedUtf8Text = await client.callTool({
			name: 'write_terminal',
			arguments: { terminal: 'sibling', text: 'é'.repeat(32_769) },
		});
		assert.equal(oversizedUtf8Text.isError, true);
		assert.match(
			oversizedUtf8Text.content.find((item) => item.type === 'text')?.text ?? '',
			/Input validation error/,
		);
		assert.equal(
			receivedOperations.includes('write_terminal'),
			false,
			'UTF-8-byte-invalid MCP arguments must not reach the local control socket',
		);
	} finally {
		await client.close().catch(() => {});
		await new Promise((resolve) => control.close(resolve));
		await rm(root, { recursive: true, force: true });
	}
});

test('headless MCP recovers after a malformed local control response closes its prior socket', async () => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-server-mcp-recovery-'));
	const socketPath = join(root, 'control.sock');
	let connections = 0;
	const control = createServer((socket) => {
		connections += 1;
		const connection = connections;
		const decoder = new ControlFrameDecoder();
		socket.on('data', (chunk) => {
			for (const request of decoder.push(chunk)) {
				if (connection === 1) {
					// Valid JSON framing but not a valid ControlResponse. The MCP
					// client must reject this request, discard only this socket, and
					// allow the next call to establish a new local connection.
					socket.write(encodeControlMessage({ id: request.id, ok: false }));
					continue;
				}
				socket.write(
					encodeControlMessage({
						id: request.id,
						ok: true,
						result: { terminals: [{ id: 'recovered', busy: false }] },
					}),
				);
			}
		});
	});
	await new Promise((resolve) => control.listen(socketPath, resolve));
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [fileURLToPath(new URL('../dist/mcpEntry.js', import.meta.url))],
		env: {
			...process.env,
			TERMINAY_CONTROL_SOCKET: socketPath,
			TERMINAY_CONTROL_TOKEN: 'test-token',
		},
		stderr: 'pipe',
	});
	const client = new Client({ name: 'server-mcp-recovery-test', version: '1.0.0' });
	try {
		await client.connect(transport);
		const malformed = await client.callTool({
			name: 'list_terminals',
			arguments: {},
		});
		assert.equal(malformed.isError, true);
		assert.match(
			malformed.content.find((item) => item.type === 'text')?.text ?? '',
			/^internal:/,
		);

		const recovered = await client.callTool({
			name: 'list_terminals',
			arguments: {},
		});
		assert.notEqual(recovered.isError, true, JSON.stringify(recovered));
		assert.match(
			recovered.content.find((item) => item.type === 'text')?.text ?? '',
			/recovered/,
		);
		assert.equal(connections, 2);
	} finally {
		await client.close().catch(() => {});
		await new Promise((resolve) => control.close(resolve));
		await rm(root, { recursive: true, force: true });
	}
});
