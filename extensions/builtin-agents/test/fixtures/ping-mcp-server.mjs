#!/usr/bin/env node
// A minimal stdio MCP server with one tool, `ping`, for conformance runs. The
// tool carries no read-only hint, as Terminay's write tools do not, so a run
// proves the agent calls such tools without asking a second time.
import { createInterface } from 'node:readline';

const out = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
createInterface({ input: process.stdin }).on('line', (line) => {
	const message = JSON.parse(line);
	if (message.id === undefined) return;
	const reply = (result) => out({ jsonrpc: '2.0', id: message.id, result });
	switch (message.method) {
		case 'initialize':
			return reply({
				protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
				capabilities: { tools: {} },
				serverInfo: { name: 'ping', version: '1.0.0' },
			});
		case 'tools/list':
			return reply({
				tools: [
					{
						name: 'ping',
						description: 'Returns a fixed word.',
						inputSchema: { type: 'object', properties: {} },
					},
				],
			});
		case 'tools/call':
			return reply({ content: [{ type: 'text', text: 'pong-from-terminay' }] });
		default:
			return out({
				jsonrpc: '2.0',
				id: message.id,
				error: { code: -32601, message: 'not found' },
			});
	}
});
