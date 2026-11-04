import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

for await (const line of createInterface({ input: process.stdin })) {
	const e = JSON.parse(line);
	if (e.id === undefined) continue;
	let result = {};
	if (e.method === 'initialize')
		result = {
			protocolVersion: '2025-03-26',
			capabilities: { tools: {} },
			serverInfo: { name: 'native-gate', version: '1' },
		};
	if (e.method === 'tools/list')
		result = {
			tools: [
				{
					name: 'chat_post',
					description: 'Post explicitly',
					inputSchema: {
						type: 'object',
						properties: { text: { type: 'string' }, key: { type: 'string' } },
						required: ['text', 'key'],
					},
				},
			],
		};
	if (e.method === 'tools/call') {
		writeFileSync('/home/bot/mcp-proof.json', JSON.stringify(e.params));
		result = { content: [{ type: 'text', text: 'posted' }] };
	}
	process.stdout.write(
		`${JSON.stringify({ jsonrpc: '2.0', id: e.id, result })}\n`,
	);
}
