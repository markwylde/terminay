import assert from 'node:assert/strict';
import test from 'node:test';
import { McpServerControlClient } from '../dist/index.js';

test('MCP server control client validates status and acknowledged mutations', async () => {
	const calls = [];
	const client = new McpServerControlClient({
		query: async (operation, payload) => {
			calls.push({ operation, payload });
			return {
				servers: [{ id: 'docs', label: 'Documentation', state: 'stopped' }],
			};
		},
		command: async (operation, payload) => {
			calls.push({ operation, payload });
			return { serverId: 'docs', state: 'running', acknowledged: true };
		},
	});

	assert.deepEqual(await client.list(), [
		{ id: 'docs', label: 'Documentation', state: 'stopped' },
	]);
	assert.deepEqual(await client.control('docs', 'start'), {
		serverId: 'docs',
		state: 'running',
		acknowledged: true,
	});
	assert.deepEqual(calls, [
		{ operation: 'mcp.servers.list', payload: {} },
		{
			operation: 'mcp.servers.control',
			payload: { serverId: 'docs', action: 'start' },
		},
	]);
});

test('MCP server control client rejects malformed status and acknowledgements', async () => {
	const malformedList = new McpServerControlClient({
		query: async () => ({
			servers: [{ id: '../bad', label: 'Bad', state: 'running' }],
		}),
		command: async () => ({}),
	});
	await assert.rejects(() => malformedList.list(), /status is invalid/u);

	const malformedAck = new McpServerControlClient({
		query: async () => ({ servers: [] }),
		command: async () => ({
			serverId: 'other',
			state: 'running',
			acknowledged: true,
		}),
	});
	await assert.rejects(
		() => malformedAck.control('docs', 'start'),
		/acknowledgement is invalid/u,
	);
});
