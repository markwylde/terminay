#!/usr/bin/env node
// Checks that real agent CLIs, unmodified, can show an app window and call a
// connected server's tool through the Terminay MCP server.
//
// It stands up the real control endpoint, window store, permission gate and
// gateway on a throwaway socket, gives each CLI the stdio adapter with the
// same two environment variables a Terminay terminal has, asks it to call two
// tools, and reports what reached the window store. Needs the CLIs installed
// and signed in; it is run by hand, not in CI.
//
//   npm run build:application-graph && npm run build:server-postcompile
//   node scripts/app-windows-real-agents.mjs [claude] [codex]

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	AppWindowService,
	DEFAULT_MCP_PERMISSIONS,
	McpApprovalService,
} from '@terminay/server-core';

const here = fileURLToPath(new URL('.', import.meta.url));
const serverDist = join(here, '../apps/terminay-server/dist');
const {
	ConnectedServerGateway,
	ControlCapabilityStore,
	createAppWindowControlAdapter,
	createControlEndpoint,
	createMcpPermissionGate,
	createTerminalControlAdapter,
} = await import(join(serverDist, 'index.js'));

const entry = join(serverDist, 'mcpEntry.js');
const fixture = join(here, '../apps/terminay-server/test/fixtures/upstream-apps-server.mjs');
const root = await mkdtemp(join(tmpdir(), 'terminay-real-agents-'));
const socketPath = join(root, 'control.sock');

const windows = new AppWindowService({ isPresentationHolder: () => true });
const gateway = new ConnectedServerGateway({ projectRoot: () => root });
gateway.setEntries([
	{ name: 'diagrams', enabled: true, transport: 'stdio', command: process.execPath, args: [fixture] },
]);
const capabilities = new ControlCapabilityStore();
const endpoint = createControlEndpoint({
	socketPath,
	capabilities,
	dispatch: createTerminalControlAdapter({
		adapter: {},
		appWindows: createAppWindowControlAdapter({ windows, gateway }),
		takeModelContext: (context) => windows.takeModelContext(context.terminalSessionId),
		permissions: createMcpPermissionGate({
			approvals: new McpApprovalService({ policies: DEFAULT_MCP_PERMISSIONS }),
			describe: async () => ({ agent: 'An agent', terminalTitle: 'Terminal', summary: '', details: [] }),
		}),
	}),
});
await endpoint.start();

const PROMPT =
	'Do exactly two tool calls and nothing else. First call the Terminay MCP tool show_window with title "Hello" and html "<h1>Hello world</h1>". Then call the Terminay MCP tool diagrams__draw with shape "circle". Then reply with the single word: done';

function run(command, args, env) {
	return new Promise((resolve) => {
		const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
		let output = '';
		child.stdout.on('data', (chunk) => (output += chunk));
		child.stderr.on('data', (chunk) => (output += chunk));
		const timer = setTimeout(() => child.kill(), 180_000);
		child.on('error', (error) => { clearTimeout(timer); resolve({ code: -1, output: String(error) }); });
		child.on('exit', (code) => { clearTimeout(timer); resolve({ code, output }); });
	});
}

const agents = {
	claude: async (env) => {
		const config = join(root, 'claude-mcp.json');
		await writeFile(config, JSON.stringify({ mcpServers: { terminay: { command: process.execPath, args: [entry] } } }));
		return run('claude', ['-p', PROMPT, '--mcp-config', config, '--strict-mcp-config', '--allowedTools', 'mcp__terminay__show_window,mcp__terminay__diagrams__draw'], env);
	},
	codex: (env) =>
		run(
			'codex',
			[
				'exec',
				'--skip-git-repo-check',
				'-c', `mcp_servers.terminay.command="${process.execPath}"`,
				'-c', `mcp_servers.terminay.args=["${entry}"]`,
				PROMPT,
			],
			env,
		),
};

const wanted = process.argv.slice(2).length > 0 ? process.argv.slice(2) : Object.keys(agents);
const report = {};
for (const name of wanted) {
	const session = `session-${name}`;
	const { token } = capabilities.mint(session, 'project-real');
	const { code, output } = await agents[name]({
		...process.env,
		TERMINAY_CONTROL_SOCKET: socketPath,
		TERMINAY_CONTROL_TOKEN: token,
	});
	const opened = windows.list(session);
	report[name] = {
		exit: code,
		showWindow: opened.some((window) => window.source.kind === 'agent' && window.title === 'Hello'),
		connectedToolView: opened.some((window) => window.source.kind === 'mcp-app' && window.source.tool === 'draw'),
		windows: opened.map((window) => `${window.title} (${window.source.kind})`),
		tail: output.trim().split('\n').slice(-4).join(' | ').slice(-400),
	};
}
console.log(JSON.stringify(report, null, 2));
gateway.closeAll();
await endpoint.stop();
process.exit(0);
