#!/usr/bin/env node
// The stdio MCP server an agent CLI launches. Like Terminay's real adapter it is a
// thin proxy: identity comes from the token in the terminal's environment, never
// from request parameters, so every call is attributed to the calling terminal.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const url = process.env.MCP_APPS_SPIKE_URL;
const token = process.env.MCP_APPS_SPIKE_TOKEN;

export async function control(operation, body) {
	if (!url || !token)
		throw new Error(
			'Not running inside a spike terminal (MCP_APPS_SPIKE_URL/TOKEN unset).',
		);
	const response = await fetch(`${url}/control/${operation}`, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${token}`,
			'content-type': 'application/json',
		},
		body: JSON.stringify(body ?? {}),
	});
	const payload = await response.json();
	if (!response.ok)
		throw new Error(
			payload.error ?? `Control endpoint returned ${response.status}`,
		);
	return payload;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const server = new Server(
		{ name: 'terminay-apps-gateway', version: '0.0.0' },
		{ capabilities: { tools: {} } },
	);

	server.setRequestHandler(ListToolsRequestSchema, async () =>
		control('list-tools'),
	);

	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		try {
			const { spike: _spike, ...result } = await control('call-tool', {
				name: request.params.name,
				arguments: request.params.arguments ?? {},
			});
			return result;
		} catch (error) {
			return {
				isError: true,
				content: [{ type: 'text', text: error.message }],
			};
		}
	});

	await server.connect(new StdioServerTransport());
}
