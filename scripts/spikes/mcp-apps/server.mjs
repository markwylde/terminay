#!/usr/bin/env node
// MCP Apps placement spike — the stand-in for Terminay's privileged side.
//
// It owns three things Terminay's server already owns in the real product:
//   1. the PTY for a terminal session (served to an xterm.js page over a WebSocket),
//   2. the control endpoint the per-terminal stdio MCP adapter (gateway.mjs) calls,
//   3. NEW: MCP *client* connections to upstream servers, advertising the
//      `io.modelcontextprotocol/ui` extension so those servers offer their Apps.
//
// The agent CLI (Claude Code, Codex, …) is never hooked. It only sees an ordinary
// stdio MCP server whose tools happen to be proxied.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import pty from 'node-pty';
import { WebSocketServer } from 'ws';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const HOST_PORT = Number(process.env.MCP_APPS_SPIKE_PORT ?? 4517);
const SANDBOX_PORT = HOST_PORT + 1;
const HOST_ORIGIN = `http://127.0.0.1:${HOST_PORT}`;
const SANDBOX_ORIGIN = `http://127.0.0.1:${SANDBOX_PORT}`;
const UI_EXTENSION = 'io.modelcontextprotocol/ui';
const UI_MIME = 'text/html;profile=mcp-app';

// ---------------------------------------------------------------- upstreams

/** exposed tool name -> { upstream, client, tool } */
const catalog = new Map();
const upstreams = new Map();

function loadUpstreamConfig() {
	const file = path.join(here, 'upstreams.json');
	if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
	return {
		demo: {
			command: process.execPath,
			args: [path.join(here, 'demo-upstream.mjs')],
		},
	};
}

async function connectUpstreams() {
	for (const [name, spec] of Object.entries(loadUpstreamConfig())) {
		const client = new Client(
			{ name: 'terminay-mcp-apps-spike', version: '0.0.0' },
			{
				capabilities: {
					extensions: { [UI_EXTENSION]: { mimeTypes: [UI_MIME] } },
				},
			},
		);
		try {
			await client.connect(
				new StdioClientTransport({
					command: spec.command,
					args: spec.args ?? [],
					env: { ...process.env, ...(spec.env ?? {}) },
					stderr: 'inherit',
				}),
			);
			const { tools } = await client.listTools();
			upstreams.set(name, { client, tools, uiCache: new Map() });
			for (const tool of tools) {
				const exposed = catalog.has(tool.name)
					? `${name}_${tool.name}`
					: tool.name;
				catalog.set(exposed, { upstream: name, client, tool });
			}
			console.log(
				`upstream "${name}": ${tools.length} tools (${tools.filter(uiUri).length} with UI)`,
			);
		} catch (error) {
			console.error(`upstream "${name}" failed to connect: ${error.message}`);
		}
	}
}

const uiUri = (tool) =>
	tool._meta?.ui?.resourceUri ?? tool._meta?.['ui/resourceUri'];
const visibility = (tool) => tool._meta?.ui?.visibility ?? ['model', 'app'];

async function readUiResource(upstreamName, uri) {
	const upstream = upstreams.get(upstreamName);
	if (upstream.uiCache.has(uri)) return upstream.uiCache.get(uri);
	const { contents } = await upstream.client.readResource({ uri });
	const entry = contents[0];
	const html = entry.text ?? Buffer.from(entry.blob, 'base64').toString('utf8');
	const ui = { html, meta: entry._meta?.ui ?? {} };
	upstream.uiCache.set(uri, ui);
	return ui;
}

// ----------------------------------------------------------------- sessions

/** token -> session */
const sessions = new Map();
const shortId = () =>
	crypto
		.randomBytes(3)
		.toString('base64url')
		.toLowerCase()
		.replace(/[^a-z0-9]/g, 'x')
		.slice(0, 4);

const spikeDir = fs.mkdtempSync(
	path.join(os.tmpdir(), 'terminay-mcp-apps-spike-'),
);
const mcpConfigPath = path.join(spikeDir, 'mcp.json');
const gatewayPath = path.join(here, 'gateway.mjs');
const showApp = path.relative(repoRoot, path.join(here, 'show-app.mjs'));
fs.writeFileSync(
	mcpConfigPath,
	JSON.stringify(
		{
			mcpServers: { apps: { command: process.execPath, args: [gatewayPath] } },
		},
		null,
		2,
	),
);

function send(session, message) {
	if (session.ws.readyState === 1)
		session.ws.send(JSON.stringify({ sid: session.sid, ...message }));
}

// One browser page hosts many terminals. Each gets its own PTY and its own token,
// so a tool call is attributed to exactly the terminal the agent runs in.
function openConnection(ws) {
	const bySid = new Map();
	const hello = {
		t: 'hello',
		commands: {
			claude: 'claude --mcp-config "$MCP_APPS_SPIKE_CONFIG"',
			codex: `codex -c 'mcp_servers.apps.command="${process.execPath}"' -c 'mcp_servers.apps.args=["${gatewayPath}"]' -c 'mcp_servers.apps.env_vars=["MCP_APPS_SPIKE_URL","MCP_APPS_SPIKE_TOKEN"]'`,
			plain: `node ${showApp} system_monitor`,
			hello: `node ${showApp} hello_world`,
			deploy: `node ${showApp} deploy_configurator '{"service":"api"}'`,
			delayed: `sleep 6; node ${showApp} deploy_configurator '{"service":"api"}'`,
		},
	};
	ws.send(JSON.stringify(hello));

	ws.on('message', async (raw) => {
		let m;
		try {
			m = JSON.parse(raw.toString());
		} catch {
			return;
		}
		if (m.t === 'open') {
			if (!bySid.has(m.sid)) bySid.set(m.sid, openSession(ws, m));
			return;
		}
		const session = bySid.get(m.sid);
		if (!session) return;
		if (m.t === 'input') session.term.write(m.d);
		else if (m.t === 'resize')
			session.term.resize(Math.max(2, m.cols), Math.max(2, m.rows));
		else if (m.t === 'reserved') session.reserveWaiters.get(m.id)?.(m.rows);
		else if (m.t === 'model-context') session.modelContext = m.context;
		else if (m.t === 'rpc')
			send(session, {
				t: 'rpc-result',
				reqId: m.reqId,
				...(await appRpc(session, m)),
			});
	});
	ws.on('close', () => {
		for (const session of bySid.values()) {
			sessions.delete(session.token);
			session.term.kill();
		}
	});
}

function openSession(ws, { sid, cols, rows }) {
	const token = crypto.randomBytes(24).toString('base64url');
	const term = pty.spawn(process.env.SHELL ?? '/bin/zsh', ['-l'], {
		name: 'xterm-256color',
		cols: Math.max(2, cols ?? 100),
		rows: Math.max(2, rows ?? 30),
		cwd: repoRoot,
		env: {
			...process.env,
			TERM_PROGRAM: 'terminay-spike',
			MCP_APPS_SPIKE_URL: HOST_ORIGIN,
			MCP_APPS_SPIKE_TOKEN: token,
			MCP_APPS_SPIKE_CONFIG: mcpConfigPath,
		},
	});
	const session = {
		sid,
		token,
		ws,
		term,
		apps: new Map(),
		modelContext: null,
		reserveWaiters: new Map(),
	};
	sessions.set(token, session);
	term.onData((d) => send(session, { t: 'output', d }));
	term.onExit(() =>
		send(session, { t: 'output', d: '\r\n[shell exited]\r\n' }),
	);
	return session;
}

// A View's own requests. It may only reach the server its resource came from, and
// only tools that server marked app-visible.
async function appRpc(session, { appId, method, params }) {
	const app = session.apps.get(appId);
	if (!app) return { error: { code: -32000, message: 'Unknown app instance' } };
	const upstream = upstreams.get(app.upstream);
	try {
		if (method === 'tools/call') {
			const tool = upstream.tools.find((t) => t.name === params?.name);
			if (!tool || !visibility(tool).includes('app')) {
				return {
					error: {
						code: -32602,
						message: `Tool not callable by this app: ${params?.name}`,
					},
				};
			}
			return {
				result: await upstream.client.callTool({
					name: tool.name,
					arguments: params.arguments ?? {},
				}),
			};
		}
		if (method === 'resources/read')
			return {
				result: await upstream.client.readResource({ uri: params.uri }),
			};
		return {
			error: { code: -32601, message: `Method not proxied: ${method}` },
		};
	} catch (error) {
		return { error: { code: -32000, message: error.message } };
	}
}

// ------------------------------------------------- control API (for gateway)

function modelVisibleTools() {
	return [...catalog.entries()]
		.filter(([, entry]) => visibility(entry.tool).includes('model'))
		.map(([name, entry]) => ({ ...entry.tool, name }));
}

async function callTool(
	session,
	{ name, arguments: args = {}, reserve = false },
) {
	const entry = catalog.get(name);
	if (!entry || !visibility(entry.tool).includes('model'))
		throw new Error(`Unknown tool: ${name}`);

	const uri = uiUri(entry.tool);
	let app;
	let rows = 0;
	if (uri && session.ws.readyState === 1) {
		const ui = await readUiResource(entry.upstream, uri);
		app = {
			id: shortId(),
			upstream: entry.upstream,
			title: entry.tool.title ?? entry.tool.name,
		};
		session.apps.set(app.id, app);
		send(session, {
			t: 'app-open',
			app: {
				id: app.id,
				title: app.title,
				server: entry.upstream,
				tool: entry.tool,
				html: ui.html,
				csp: ui.meta.csp,
				permissions: ui.meta.permissions,
				args,
				reserve,
			},
		});
		if (reserve) {
			rows = await new Promise((resolve) => {
				const timer = setTimeout(() => resolve(0), 2500);
				session.reserveWaiters.set(app.id, (n) => {
					clearTimeout(timer);
					resolve(n);
				});
			});
			session.reserveWaiters.delete(app.id);
		}
	}

	let result;
	try {
		result = await entry.client.callTool({
			name: entry.tool.name,
			arguments: args,
		});
	} catch (error) {
		if (app)
			send(session, { t: 'app-cancelled', id: app.id, reason: error.message });
		throw error;
	}
	if (app) send(session, { t: 'app-result', id: app.id, result });

	// What the *model* gets back. The first line doubles as the anchor Terminay
	// scans for in the terminal buffer: any agent TUI echoes the head of a tool
	// result, which tells us where in the scrollback the call happened.
	const content = [...(result.content ?? [])];
	if (app) {
		content.unshift({
			type: 'text',
			text: `▣ app:${app.id} · "${app.title}" is open as an interactive view in the user's terminal. They can see and use it — don't restate its contents.`,
		});
	}
	if (session.modelContext) {
		content.push({
			type: 'text',
			text: `Context from the open app view:\n${session.modelContext}`,
		});
		session.modelContext = null;
	}
	return { ...result, content, spike: { appId: app?.id ?? null, rows } };
}

async function readJson(req) {
	const chunks = [];
	for await (const chunk of req) chunks.push(chunk);
	return chunks.length
		? JSON.parse(Buffer.concat(chunks).toString('utf8'))
		: {};
}

async function handleControl(req, res, route) {
	const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
	const session = sessions.get(token);
	const reply = (status, body) => {
		res.writeHead(status, { 'content-type': 'application/json' });
		res.end(JSON.stringify(body));
	};
	if (!session) return reply(401, { error: 'Unknown terminal session token' });
	try {
		if (route === 'list-tools')
			return reply(200, { tools: modelVisibleTools() });
		if (route === 'call-tool')
			return reply(200, await callTool(session, await readJson(req)));
		return reply(404, { error: 'Unknown control operation' });
	} catch (error) {
		return reply(500, { error: error.message });
	}
}

// ------------------------------------------------------------------- static

const mime = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.mjs': 'text/javascript',
	'.css': 'text/css',
	'.map': 'application/json',
};
const vendor = {
	'/vendor/xterm.mjs': 'node_modules/@xterm/xterm/lib/xterm.mjs',
	'/vendor/xterm.css': 'node_modules/@xterm/xterm/css/xterm.css',
	'/vendor/addon-fit.mjs': 'node_modules/@xterm/addon-fit/lib/addon-fit.mjs',
};

function serveFile(res, file, transform) {
	if (!fs.existsSync(file)) {
		res.writeHead(404).end('not found');
		return;
	}
	let body = fs.readFileSync(file);
	if (transform) body = transform(body.toString('utf8'));
	res.writeHead(200, {
		'content-type': `${mime[path.extname(file)] ?? 'application/octet-stream'}; charset=utf-8`,
		'cache-control': 'no-store',
	});
	res.end(body);
}

const hostServer = http.createServer((req, res) => {
	const url = new URL(req.url, HOST_ORIGIN);
	if (url.pathname.startsWith('/control/'))
		return handleControl(req, res, url.pathname.slice('/control/'.length));
	if (vendor[url.pathname])
		return serveFile(res, path.join(repoRoot, vendor[url.pathname]));
	const name =
		url.pathname === '/' ? 'index.html' : path.basename(url.pathname);
	return serveFile(
		res,
		path.join(here, 'public', name),
		name === 'index.html'
			? (s) => s.replaceAll('__SANDBOX_ORIGIN__', SANDBOX_ORIGIN)
			: undefined,
	);
});

// The sandbox proxy lives on its own origin so a View can never reach the host page.
const sandboxServer = http.createServer((_req, res) => {
	serveFile(res, path.join(here, 'public', 'sandbox.html'), (s) =>
		s.replaceAll('__HOST_ORIGIN__', HOST_ORIGIN),
	);
});

const wss = new WebSocketServer({ server: hostServer, path: '/ws' });
wss.on('connection', (ws, req) => {
	if (req.headers.origin !== HOST_ORIGIN) return ws.close();
	openConnection(ws);
});

await connectUpstreams();
hostServer.listen(HOST_PORT, '127.0.0.1');
sandboxServer.listen(SANDBOX_PORT, '127.0.0.1');
console.log(
	`\nMCP Apps spike → ${HOST_ORIGIN}\n(sandbox origin ${SANDBOX_ORIGIN}, mcp config ${mcpConfigPath})`,
);
