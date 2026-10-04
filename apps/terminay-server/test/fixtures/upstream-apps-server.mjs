#!/usr/bin/env node
// A third-party-style MCP server with an MCP App, used as the upstream in
// gateway tests. It knows nothing about Terminay. It records what it was
// started with so a test can check the working directory and environment.
import { writeFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	CallToolRequestSchema,
	ListResourcesRequestSchema,
	ListToolsRequestSchema,
	ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const UI_MIME = 'text/html;profile=mcp-app';
const VIEW = `<!doctype html><html><body><pre id="out">waiting</pre><script>
const out = document.getElementById('out');
const seen = {};
let id = 0;
const pending = new Map();
const request = (method, params) => new Promise((resolve) => { const key = ++id; pending.set(key, resolve); parent.postMessage({ jsonrpc: '2.0', id: key, method, params }, '*'); });
addEventListener('message', (event) => {
	const m = event.data; if (!m || m.jsonrpc !== '2.0') return;
	if (m.method === 'ui/notifications/tool-input') seen.input = m.params.arguments;
	if (m.method === 'ui/notifications/tool-result') seen.result = m.params.structuredContent;
	if (m.method === undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
	out.textContent = JSON.stringify(seen);
});
(async () => {
	await request('ui/initialize', { protocolVersion: '2026-01-26', appInfo: { name: 'fixture', version: '1' }, appCapabilities: {} });
	parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }, '*');
	parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { width: 300, height: 120 } }, '*');
	const polled = await request('tools/call', { name: 'poll', arguments: {} });
	seen.polled = polled.result ? polled.result.structuredContent : polled.error.message;
	const denied = await request('tools/call', { name: 'draw', arguments: {} });
	seen.modelOnly = denied.error ? 'refused' : 'allowed';
	// Whether the view's content security policy lets it connect. Only the
	// policy is being observed, so it does not matter that neither host exists.
	const violations = [];
	addEventListener('securitypolicyviolation', (event) => violations.push(event.blockedURI));
	const attempt = async (url) => { try { await fetch(url, { mode: 'no-cors' }); } catch {} };
	await attempt('https://api.example/declared');
	await attempt('https://undeclared.example/x');
	await new Promise((resolve) => setTimeout(resolve, 50));
	const blocked = (host) => violations.some((uri) => uri.includes(host)) ? 'blocked' : 'allowed';
	seen.csp = { declared: blocked('api.example'), undeclared: blocked('undeclared.example') };
	out.textContent = JSON.stringify(seen);
})();
</script></body></html>`;

if (process.env.FIXTURE_STARTED_FILE)
	writeFileSync(
		process.env.FIXTURE_STARTED_FILE,
		JSON.stringify({
			cwd: process.cwd(),
			hasControlSocket: 'TERMINAY_CONTROL_SOCKET' in process.env,
			hasControlToken: 'TERMINAY_CONTROL_TOKEN' in process.env,
			secret: process.env.FIXTURE_SECRET ?? null,
			pid: process.pid,
		}),
		{ flag: 'a' },
	);
if (process.env.FIXTURE_FAIL === '1') process.exit(3);

let clientCapabilities;
const tools = [
	{
		name: 'draw',
		title: 'Draw a diagram',
		description: 'Draw a shape and show it.',
		inputSchema: { type: 'object', properties: { shape: { type: 'string' } } },
		_meta: { ui: { resourceUri: 'ui://diagrams/draw', visibility: ['model'] } },
	},
	{ name: 'plain', description: 'No view.', inputSchema: { type: 'object', properties: {} } },
	{ name: 'poll', description: 'Polled by the view.', inputSchema: { type: 'object', properties: {} }, _meta: { ui: { visibility: ['app'] } } },
	{ name: 'capabilities', description: 'What the client advertised.', inputSchema: { type: 'object', properties: {} } },
	{ name: 'huge', description: 'Returns more than 1 MiB.', inputSchema: { type: 'object', properties: {} } },
];

const server = new Server(
	{ name: 'fixture-apps', version: '1.0.0' },
	{ capabilities: { tools: { listChanged: true }, resources: {} } },
);
server.oninitialized = () => {
	clientCapabilities = server.getClientCapabilities();
};
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
	resources: [{ uri: 'ui://diagrams/draw', name: 'draw', mimeType: UI_MIME }],
}));
server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
	if (params.uri !== 'ui://diagrams/draw') throw new Error(`Unknown resource ${params.uri}`);
	return {
		contents: [
			{
				uri: params.uri,
				mimeType: process.env.FIXTURE_UI_MIME ?? UI_MIME,
				text: VIEW,
				_meta: { ui: { csp: { connectDomains: ['https://api.example'] }, permissions: { clipboardWrite: {} } } },
			},
		],
	};
});
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
	switch (params.name) {
		case 'draw':
			return { content: [{ type: 'text', text: `drew ${params.arguments?.shape ?? 'nothing'}` }], structuredContent: { shapes: 1 } };
		case 'plain':
			return { content: [{ type: 'text', text: 'plain result' }] };
		case 'poll':
			return { content: [{ type: 'text', text: 'polled' }], structuredContent: { polled: true } };
		case 'capabilities':
			return { content: [{ type: 'text', text: JSON.stringify(clientCapabilities ?? null) }] };
		case 'huge':
			return { content: [{ type: 'text', text: 'x'.repeat(1024 * 1024 + 10) }] };
		default:
			return { isError: true, content: [{ type: 'text', text: `Unknown tool ${params.name}` }] };
	}
});
await server.connect(new StdioServerTransport());
