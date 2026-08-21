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
	CONTROL_MAX_RESPONSE_BYTES,
	encodeControlMessage,
} from '../dist/mcp/controlEndpoint.js';
import { runServerMcpStdio } from '../dist/mcp/stdio.js';

const expectedTools = [
	'close_terminal',
	'focus_terminal',
	'get_mcp_capabilities',
	'get_terminal_status',
	'list_terminals',
	'open_terminal',
	'read_terminal',
	'rename_terminal',
	'run_command',
	'search_terminal',
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
	const receivedReadParams = [];
	const receivedSearchParams = [];
	const control = createServer((socket) => {
		const decoder = new ControlFrameDecoder();
		socket.on('data', (chunk) => {
			for (const request of decoder.push(chunk)) {
				receivedOperations.push(request.op);
				if (request.op === 'read_terminal') receivedReadParams.push(request.params);
				if (request.op === 'search_terminal')
					receivedSearchParams.push(request.params);
				assert.equal(request.token, 'test-token');
				if (
					request.op === 'read_terminal' &&
					request.params.terminal === 'missing'
				) {
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
				const result =
					request.op === 'get_mcp_capabilities'
						? {
								tools: [
									{ name: 'wait_for_attention', available: false },
									{ name: 'wait_for_command', available: false },
									{ name: 'search_terminal', available: true },
								],
							}
						: request.op === 'list_terminals'
						? {
								terminals: [{ id: 'sibling', busy: false }],
							}
						: request.op === 'read_terminal' &&
								request.params.terminal === 'large'
							? {
									terminal: 'large',
									// Quotes exercise JSON escaping, so this verifies the
									// final MCP text rather than only the raw output size.
									output: '"'.repeat(65_536),
									from: 0,
									next: 65_536,
								}
							: { ok: true };
				socket.write(
					encodeControlMessage({
						id: request.id,
						ok: true,
						result,
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
		const readTool = tools.tools.find((tool) => tool.name === 'read_terminal');
		const readSchema = readTool?.inputSchema;
		const searchTool = tools.tools.find((tool) => tool.name === 'search_terminal');
		const searchSchema = searchTool?.inputSchema;
		const capabilitiesTool = tools.tools.find(
			(tool) => tool.name === 'get_mcp_capabilities',
		);
		const listTool = tools.tools.find(
			(tool) => tool.name === 'list_terminals',
		);
		assert.deepEqual(listTool?.annotations, {
			readOnlyHint: true,
			destructiveHint: false,
			openWorldHint: false,
		});
		assert.equal(readSchema?.properties?.lines?.maximum, 4096);
		assert.deepEqual(readSchema?.properties?.format?.enum, [
			'text',
			'ansi',
			'raw',
		]);
		assert.equal(readSchema?.properties?.format?.default, 'text');
		assert.equal(readSchema?.properties?.max_bytes?.exclusiveMinimum, 0);
		assert.equal(readSchema?.properties?.max_bytes?.maximum, 65536);
		assert.equal(readSchema?.properties?.max_bytes?.default, 16384);
		assert.equal(readSchema?.properties?.after?.minimum, 0);
		assert.equal(readSchema?.properties?.after?.maximum, Number.MAX_SAFE_INTEGER);
		assert.equal(searchSchema?.properties?.query?.minLength, 1);
		assert.equal(searchSchema?.properties?.case_sensitive?.default, true);
		assert.equal(searchSchema?.properties?.context_lines?.minimum, 0);
		assert.equal(searchSchema?.properties?.context_lines?.maximum, 20);
		assert.equal(searchSchema?.properties?.context_lines?.default, 2);
		assert.equal(searchSchema?.properties?.max_matches?.exclusiveMinimum, 0);
		assert.equal(searchSchema?.properties?.max_matches?.maximum, 100);
		assert.equal(searchSchema?.properties?.max_matches?.default, 20);
		assert.equal(searchSchema?.properties?.max_bytes?.exclusiveMinimum, 0);
		assert.equal(searchSchema?.properties?.max_bytes?.maximum, 65536);
		assert.equal(searchSchema?.properties?.max_bytes?.default, 16384);
		assert.match(readTool?.description ?? '', /emulated visual rows/i);
		assert.match(readTool?.description ?? '', /raw output-byte cursor/i);
		assert.match(listTool?.description ?? '', /SSH session/i);
		assert.match(capabilitiesTool?.description ?? '', /adapter-global/i);
		assert.match(searchTool?.description ?? '', /literal Unicode query/i);
		assert.match(searchTool?.description ?? '', /never a regular expression/i);
		const runTool = tools.tools.find((tool) => tool.name === 'run_command');
		const commandWaitTool = tools.tools.find(
			(tool) => tool.name === 'wait_for_command',
		);
		assert.match(runTool?.description ?? '', /submitted_bytes/i);
		assert.match(runTool?.description ?? '', /does not attribute/i);
		assert.match(commandWaitTool?.description ?? '', /get_mcp_capabilities/i);
		assert.match(commandWaitTool?.description ?? '', /does not correlate/i);
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
		const capabilities = await client.callTool({
			name: 'get_mcp_capabilities',
			arguments: {},
		});
		assert.notEqual(capabilities.isError, true, JSON.stringify(capabilities));
		assert.match(
			capabilities.content.find((item) => item.type === 'text')?.text ?? '',
			/"search_terminal"/,
		);
		const waited = await client.callTool({
			name: 'wait_for_idle',
			arguments: { terminal: 'sibling', seconds: 0 },
		});
		assert.notEqual(waited.isError, true, JSON.stringify(waited));
		const defaultRead = await client.callTool({
			name: 'read_terminal',
			arguments: { terminal: 'sibling' },
		});
		assert.notEqual(defaultRead.isError, true, JSON.stringify(defaultRead));
		assert.deepEqual(receivedReadParams.at(-1), {
			terminal: 'sibling',
			format: 'text',
			max_bytes: 16384,
		});
		const rawRead = await client.callTool({
			name: 'read_terminal',
			arguments: {
				terminal: 'sibling',
				format: 'raw',
				max_bytes: 24,
				after: 0,
			},
		});
		assert.notEqual(rawRead.isError, true, JSON.stringify(rawRead));
		assert.deepEqual(receivedOperations.at(-1), 'read_terminal');
		assert.deepEqual(
			receivedReadParams.at(-1),
			{
				terminal: 'sibling',
				format: 'raw',
				max_bytes: 24,
				after: 0,
			},
		);
		const defaultSearch = await client.callTool({
			name: 'search_terminal',
			arguments: { terminal: 'sibling', query: 'café' },
		});
		assert.notEqual(defaultSearch.isError, true, JSON.stringify(defaultSearch));
		assert.deepEqual(receivedSearchParams.at(-1), {
			terminal: 'sibling',
			query: 'café',
			case_sensitive: true,
			context_lines: 2,
			max_matches: 20,
			max_bytes: 16384,
		});
		const boundedSearch = await client.callTool({
			name: 'search_terminal',
			arguments: {
				terminal: 'sibling',
				query: 'Needle',
				case_sensitive: false,
				context_lines: 0,
				max_matches: 100,
				max_bytes: 65536,
			},
		});
		assert.notEqual(boundedSearch.isError, true, JSON.stringify(boundedSearch));
		assert.deepEqual(receivedSearchParams.at(-1), {
			terminal: 'sibling',
			query: 'Needle',
			case_sensitive: false,
			context_lines: 0,
			max_matches: 100,
			max_bytes: 65536,
		});
		const maxBoundRead = await client.callTool({
			name: 'read_terminal',
			arguments: {
				terminal: 'large',
				format: 'raw',
				max_bytes: 65536,
				after: 0,
			},
		});
		assert.notEqual(maxBoundRead.isError, true, JSON.stringify(maxBoundRead));
		const maxBoundText = maxBoundRead.content.find(
			(item) => item.type === 'text',
		)?.text;
		assert.ok(maxBoundText);
		assert.ok(
			Buffer.byteLength(maxBoundText, 'utf8') < CONTROL_MAX_RESPONSE_BYTES,
			'bounded output plus JSON escaping must remain below the MCP response cap',
		);
		const typedFailure = await client.callTool({
			name: 'read_terminal',
			arguments: { terminal: 'missing' },
		});
		assert.equal(typedFailure.isError, true);
		assert.equal(
			typedFailure.structuredContent?.error?.code,
			'terminal_not_found',
		);
		const searchRequestsBeforeInvalid = receivedOperations.filter(
			(operation) => operation === 'search_terminal',
		).length;
		for (const arguments_ of [
			{ terminal: 'sibling' },
			{ terminal: 'sibling', query: '' },
			{ terminal: 'sibling', query: '\0' },
			{ terminal: 'sibling', query: 'needle', case_sensitive: 'false' },
			{ terminal: 'sibling', query: 'needle', context_lines: -1 },
			{ terminal: 'sibling', query: 'needle', context_lines: 20.5 },
			{ terminal: 'sibling', query: 'needle', context_lines: 21 },
			{ terminal: 'sibling', query: 'needle', max_matches: 0 },
			{ terminal: 'sibling', query: 'needle', max_matches: 100.5 },
			{ terminal: 'sibling', query: 'needle', max_matches: 101 },
			{ terminal: 'sibling', query: 'needle', max_bytes: 0 },
			{ terminal: 'sibling', query: 'needle', max_bytes: 65537 },
			{ terminal: 'sibling', query: 'needle', max_bytes: 1.5 },
		]) {
			const invalidSearch = await client.callTool({
				name: 'search_terminal',
				arguments: arguments_,
			});
			assert.equal(invalidSearch.isError, true, JSON.stringify(invalidSearch));
			assert.match(
				invalidSearch.content.find((item) => item.type === 'text')?.text ?? '',
				/Input validation error/,
			);
		}
		assert.equal(
			receivedOperations.filter((operation) => operation === 'search_terminal')
				.length,
			searchRequestsBeforeInvalid,
			'invalid search contracts must not reach the local control socket',
		);

		const readRequestsBeforeInvalid = receivedOperations.filter(
			(operation) => operation === 'read_terminal',
		).length;
		for (const arguments_ of [
			{ terminal: 'sibling', format: 'text', after: 0 },
			{ terminal: 'sibling', format: 'ansi', after: 0 },
			{ terminal: 'sibling', format: 'raw', lines: 1 },
			{ terminal: 'sibling', format: 'bogus' },
			{ terminal: 'sibling', max_bytes: 0 },
			{ terminal: 'sibling', max_bytes: 65537 },
			{ terminal: 'sibling', max_bytes: 1.5 },
			{ terminal: 'sibling', format: 'raw', after: -1 },
			{ terminal: 'sibling', format: 'raw', after: 1.5 },
			{ terminal: 'sibling', format: 'raw', after: Number.MAX_SAFE_INTEGER + 1 },
			{ terminal: 'sibling', lines: 1.5 },
		]) {
			const invalidRead = await client.callTool({
				name: 'read_terminal',
				arguments: arguments_,
			});
			assert.equal(invalidRead.isError, true, JSON.stringify(invalidRead));
			assert.match(
				invalidRead.content.find((item) => item.type === 'text')?.text ?? '',
				/Input validation error/,
			);
		}
		assert.equal(
			receivedOperations.filter((operation) => operation === 'read_terminal')
				.length,
			readRequestsBeforeInvalid,
			'invalid read contracts must not reach the local control socket',
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
