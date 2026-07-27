import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
	const control = createServer((socket) => {
		const decoder = new ControlFrameDecoder();
		socket.on('data', (chunk) => {
			for (const request of decoder.push(chunk)) {
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
		args: ['dist/mcpEntry.js'],
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
	} finally {
		await client.close().catch(() => {});
		await new Promise((resolve) => control.close(resolve));
		await rm(root, { recursive: true, force: true });
	}
});
