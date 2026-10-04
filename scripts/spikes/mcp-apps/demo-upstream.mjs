#!/usr/bin/env node
// A small third-party-style MCP server with two MCP Apps. It knows nothing about
// Terminay: the views speak the raw SEP-1865 postMessage protocol, so they behave
// the same in Claude Desktop or any other compliant host.

import os from 'node:os';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	CallToolRequestSchema,
	ListResourcesRequestSchema,
	ListToolsRequestSchema,
	ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const UI_MIME = 'text/html;profile=mcp-app';

// Dependency-free View side of the protocol, inlined into each app.
const bridge = /* js */ `
const pending = new Map(); let nextId = 1; const handlers = {};
const request = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++; pending.set(id, { resolve, reject });
  parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
});
const notify = (method, params) => parent.postMessage({ jsonrpc: '2.0', method, params }, '*');
const on = (method, fn) => { handlers[method] = fn; };
addEventListener('message', (e) => {
  const m = e.data; if (!m || m.jsonrpc !== '2.0') return;
  if (m.method) {
    handlers[m.method]?.(m.params);
    if (m.id !== undefined) parent.postMessage({ jsonrpc: '2.0', id: m.id, result: {} }, '*');
  } else if (pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
  }
});
const applyContext = (ctx) => {
  for (const [k, v] of Object.entries(ctx?.styles?.variables ?? {})) if (v) document.documentElement.style.setProperty(k, v);
  if (ctx?.containerDimensions) document.documentElement.classList.toggle('fill', 'height' in ctx.containerDimensions);
};
on('ui/notifications/host-context-changed', applyContext);
const start = async () => {
  const init = await request('ui/initialize', {
    protocolVersion: '2026-01-26',
    appInfo: { name: document.title, version: '1.0.0' },
    appCapabilities: { availableDisplayModes: ['inline', 'fullscreen', 'pip'] },
  });
  applyContext(init.hostContext);
  new ResizeObserver(() => notify('ui/notifications/size-changed', {
    width: Math.ceil(document.documentElement.scrollWidth),
    height: Math.ceil(document.body.getBoundingClientRect().height),
  })).observe(document.body);
  notify('ui/notifications/initialized', {});
  return init;
};
`;

const baseCss = /* css */ `
:root { color-scheme: dark; }
html.fill, html.fill body { height: 100%; }
body { margin: 0; padding: 14px 16px; box-sizing: border-box;
  font: 13px/1.45 var(--font-sans, system-ui, sans-serif);
  background: var(--color-background-primary, #1b1d10); color: var(--color-text-primary, #e4e7cf); }
h1 { font-size: 13px; font-weight: 600; margin: 0 0 10px; letter-spacing: .01em; }
.muted { color: var(--color-text-secondary, #9aa07c); }
button { font: inherit; color: inherit; cursor: pointer; border-radius: var(--border-radius-md, 6px);
  border: 1px solid var(--color-border-primary, #454a28); background: var(--color-background-secondary, #262914); padding: 6px 12px; }
button:hover { border-color: var(--color-ring-primary, #b5c44a); }
button.primary { background: var(--color-ring-primary, #b5c44a); border-color: transparent; color: #14160a; font-weight: 600; }
`;

const deployHtml = /* html */ `<!doctype html><html><head><meta charset="utf-8"><title>Deploy configurator</title>
<style>${baseCss}
.grid { display: grid; grid-template-columns: 96px 1fr; gap: 10px 12px; align-items: center; }
.seg { display: flex; gap: 6px; flex-wrap: wrap; }
.seg button[aria-pressed="true"] { border-color: var(--color-ring-primary, #b5c44a); background: color-mix(in srgb, var(--color-ring-primary, #b5c44a) 18%, transparent); }
input[type=range] { width: 100%; accent-color: var(--color-ring-primary, #b5c44a); }
.row { display: flex; align-items: center; gap: 10px; margin-top: 14px; }
.cost { margin-left: auto; font-family: var(--font-mono, ui-monospace, monospace); }
</style></head><body>
<h1>Deploy <span id="svc" class="muted">…</span></h1>
<div class="grid">
  <span class="muted">Region</span><div class="seg" id="regions"></div>
  <span class="muted">Instance</span><div class="seg" id="sizes"></div>
  <span class="muted">Replicas</span><div><input id="replicas" type="range" min="1" max="12" value="2"> <span id="replicasOut">2</span></div>
  <span class="muted">Autoscale</span><label><input id="auto" type="checkbox" checked> scale on CPU &gt; 70%</label>
</div>
<div class="row"><button class="primary" id="go">Deploy with these settings</button><button id="full">Fullscreen</button><span class="cost" id="cost"></span></div>
<script>${bridge}
const state = { service: '…', region: null, size: null, replicas: 2, auto: true };
const price = { small: 12, medium: 31, large: 74 };
const seg = (el, items, key) => { el.replaceChildren(...items.map((item) => {
  const b = document.createElement('button'); b.textContent = item; b.setAttribute('aria-pressed', state[key] === item);
  b.onclick = () => { state[key] = item; render(); }; return b; })); };
let options = { regions: [], sizes: [] };
const render = () => {
  document.getElementById('svc').textContent = state.service;
  seg(document.getElementById('regions'), options.regions, 'region');
  seg(document.getElementById('sizes'), options.sizes, 'size');
  document.getElementById('replicasOut').textContent = state.replicas;
  document.getElementById('cost').textContent = state.size ? '$' + price[state.size] * state.replicas + '/mo' : '';
  // Keeps the model aware of the selection without the user typing anything.
  request('ui/update-model-context', { content: [{ type: 'text', text: 'Deploy form selection: ' + JSON.stringify(state) }] }).catch(() => {});
};
document.getElementById('replicas').oninput = (e) => { state.replicas = Number(e.target.value); render(); };
document.getElementById('auto').onchange = (e) => { state.auto = e.target.checked; render(); };
document.getElementById('full').onclick = () => request('ui/request-display-mode', { mode: 'fullscreen' });
document.getElementById('go').onclick = () => request('ui/message', { role: 'user', content: { type: 'text',
  text: 'Deploy ' + state.service + ' to ' + state.region + ' on ' + state.replicas + ' x ' + state.size + (state.auto ? ' with autoscaling' : ' without autoscaling') + '.' } });
on('ui/notifications/tool-input', (p) => { state.service = p.arguments?.service ?? 'service'; render(); });
on('ui/notifications/tool-result', (p) => { options = p.structuredContent ?? options; state.region ??= options.regions[0]; state.size ??= options.sizes[1]; render(); });
start();
</script></body></html>`;

const monitorHtml = /* html */ `<!doctype html><html><head><meta charset="utf-8"><title>System monitor</title>
<style>${baseCss}
.tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 12px; }
.tile { border: 1px solid var(--color-border-primary, #454a28); border-radius: var(--border-radius-md, 6px); padding: 8px 10px; }
.tile b { display: block; font: 600 20px/1.2 var(--font-mono, ui-monospace, monospace); }
canvas { width: 100%; height: 110px; display: block; }
html.fill canvas { height: calc(100% - 120px); min-height: 110px; }
</style></head><body>
<h1>System monitor <span class="muted" id="host"></span></h1>
<div class="tiles">
  <div class="tile"><span class="muted">Load (1m)</span><b id="load">–</b></div>
  <div class="tile"><span class="muted">Memory used</span><b id="mem">–</b></div>
  <div class="tile"><span class="muted">Cores</span><b id="cores">–</b></div>
</div>
<canvas id="chart"></canvas>
<script>${bridge}
const samples = []; const canvas = document.getElementById('chart');
const draw = () => {
  const dpr = devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr; const g = canvas.getContext('2d'); g.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const line = css.getPropertyValue('--color-ring-primary') || '#b5c44a';
  g.strokeStyle = css.getPropertyValue('--color-border-primary') || '#454a28'; g.lineWidth = 1;
  for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(0, h * i / 4); g.lineTo(w, h * i / 4); g.stroke(); }
  if (samples.length < 2) return; const max = Math.max(1, ...samples) * 1.15;
  g.beginPath(); samples.forEach((v, i) => { const x = w * i / 59, y = h - (v / max) * h; i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.strokeStyle = line; g.lineWidth = 2; g.stroke();
};
const show = (s) => { if (!s) return;
  document.getElementById('host').textContent = s.host; document.getElementById('load').textContent = s.load.toFixed(2);
  document.getElementById('mem').textContent = Math.round(s.memUsed * 100) + '%'; document.getElementById('cores').textContent = s.cores;
  samples.push(s.load); if (samples.length > 60) samples.shift(); draw(); };
on('ui/notifications/tool-result', (p) => show(p.structuredContent));
new ResizeObserver(draw).observe(canvas);
start().then(() => setInterval(async () => {
  // An app-only tool: hidden from the model, proxied by the host back to this server.
  try { show((await request('tools/call', { name: 'get_system_stats', arguments: {} })).structuredContent); } catch {}
}, 1000));
</script></body></html>`;

const helloHtml = /* html */ `<!doctype html><html><head><meta charset="utf-8"><title>Hello</title>
<style>${baseCss}
p { margin: 0; font-size: 22px; font-weight: 600; text-align: center; padding: 18px 0; }
</style></head><body>
<p>Hello World</p>
<script>${bridge}
start();
</script></body></html>`;

const stats = () => ({
	host: os.hostname(),
	load: os.loadavg()[0],
	memUsed: 1 - os.freemem() / os.totalmem(),
	cores: os.cpus().length,
});

const tools = [
	{
		name: 'deploy_configurator',
		title: 'Deploy configurator',
		description:
			'Show an interactive form for choosing deployment settings (region, instance size, replicas) for a service.',
		inputSchema: {
			type: 'object',
			properties: { service: { type: 'string', description: 'Service name' } },
			required: ['service'],
		},
		_meta: { ui: { resourceUri: 'ui://demo/deploy.html' } },
	},
	{
		name: 'system_monitor',
		title: 'System monitor',
		description: 'Show a live dashboard of this machine’s load and memory.',
		inputSchema: { type: 'object', properties: {} },
		_meta: { ui: { resourceUri: 'ui://demo/monitor.html' } },
	},
	{
		name: 'hello_world',
		title: 'Hello',
		description: 'Show a window that says Hello World.',
		inputSchema: { type: 'object', properties: {} },
		_meta: { ui: { resourceUri: 'ui://demo/hello.html' } },
	},
	{
		name: 'get_system_stats',
		description: 'Current load and memory. Polled by the system monitor view.',
		inputSchema: { type: 'object', properties: {} },
		_meta: { ui: { visibility: ['app'] } },
	},
];

const resources = {
	'ui://demo/deploy.html': deployHtml,
	'ui://demo/monitor.html': monitorHtml,
	'ui://demo/hello.html': helloHtml,
};

const server = new Server(
	{ name: 'demo-apps', version: '1.0.0' },
	{ capabilities: { tools: {}, resources: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
	resources: Object.keys(resources).map((uri) => ({
		uri,
		name: uri.split('/').pop(),
		mimeType: UI_MIME,
	})),
}));
server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
	if (!resources[params.uri]) throw new Error(`Unknown resource ${params.uri}`);
	return {
		contents: [
			{
				uri: params.uri,
				mimeType: UI_MIME,
				text: resources[params.uri],
				_meta: { ui: { prefersBorder: false } },
			},
		],
	};
});
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
	if (params.name === 'deploy_configurator') {
		const options = {
			regions: ['eu-west-1', 'us-east-1', 'ap-southeast-2'],
			sizes: ['small', 'medium', 'large'],
		};
		return {
			content: [
				{
					type: 'text',
					text: `Deployment options for ${params.arguments?.service}: ${JSON.stringify(options)}. Waiting for the user to choose.`,
				},
			],
			structuredContent: options,
		};
	}
	if (params.name === 'hello_world') {
		return { content: [{ type: 'text', text: 'Hello World' }] };
	}
	if (params.name === 'system_monitor' || params.name === 'get_system_stats') {
		const s = stats();
		return {
			content: [
				{
					type: 'text',
					text: `load ${s.load.toFixed(2)}, memory ${Math.round(s.memUsed * 100)}% used, ${s.cores} cores`,
				},
			],
			structuredContent: s,
		};
	}
	return {
		isError: true,
		content: [{ type: 'text', text: `Unknown tool ${params.name}` }],
	};
});

await server.connect(new StdioServerTransport());
