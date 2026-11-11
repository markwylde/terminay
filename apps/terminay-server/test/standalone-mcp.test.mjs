import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const mcpEntry = join(packageRoot, 'dist', 'mcpEntry.js');
const INHERITED_SOCKET = '/nonexistent/inherited.sock';
const INHERITED_TOKEN = 'tc_inherited';

// The standalone server composes the same Terminay MCP host as Desktop
// (ADR-0108): its terminals get the control socket and a capability, and an
// agent in one of them reaches the server's MCP tools through the stdio entry.
test('a standalone server terminal reaches Terminay MCP', {
	skip: process.platform === 'win32',
}, async () => {
	const server = await startServer();
	try {
		const env = await server.terminalEnvironment();
		assert.ok(env.TERMINAY_CONTROL_SOCKET, 'terminal has the control socket');
		assert.ok(env.TERMINAY_CONTROL_TOKEN, 'terminal has a capability');
		assert.notEqual(env.TERMINAY_CONTROL_SOCKET, INHERITED_SOCKET);
		assert.notEqual(env.TERMINAY_CONTROL_TOKEN, INHERITED_TOKEN);

		const client = await connectMcp(env);
		try {
			const tools = await client.listTools();
			const names = tools.tools.map((tool) => tool.name);
			assert.ok(names.includes('list_terminals'));
			assert.ok(names.includes('open_terminal'));

			const listed = await client.callTool({
				name: 'list_terminals',
				arguments: {},
			});
			assert.notEqual(listed.isError, true, JSON.stringify(listed));
			const before = JSON.stringify(listed.content);
			assert.match(before, /running/);

			// open_terminal goes through the canonical launch resolver and the
			// workspace gets a panel for it.
			const opened = await client.callTool({
				name: 'open_terminal',
				arguments: {},
			});
			assert.notEqual(opened.isError, true, JSON.stringify(opened));
			const after = await client.callTool({
				name: 'list_terminals',
				arguments: {},
			});
			assert.ok(
				countSessions(after) > countSessions(listed),
				`open_terminal added a terminal: ${JSON.stringify(after.content)}`,
			);

			// A view tool with no client showing the terminal says so.
			const noView = await client.callTool({
				name: 'focus_tab',
				arguments: { tab: 'default' },
			});
			assert.equal(noView.isError, true);
			assert.equal(
				noView.structuredContent?.error?.code,
				'renderer_unavailable',
			);
		} finally {
			await client.close();
		}
	} finally {
		await server.stop();
	}
});

// The permission policy and reach are the server's, as on Desktop: Ask First
// waits for a person, Never Allow refuses, and what is outside a project
// terminal's reach is refused before any prompt.
test('a standalone server applies the Terminay MCP permission policy', {
	skip: process.platform === 'win32',
}, async () => {
	const server = await startServer({
		terminayMcp: {
			enabled: true,
			permissions: {
				terminalsManage: 'ask',
				automationsRead: 'deny',
			},
		},
	});
	try {
		const client = await connectMcp(await server.terminalEnvironment());
		try {
			const refused = await client.callTool({
				name: 'list_automations',
				arguments: {},
			});
			assert.equal(refused.isError, true);
			assert.equal(refused.structuredContent?.error?.code, 'permission_denied');

			// Workspace reach is refused before the Ask First prompt would be shown.
			const outOfScope = await client.callTool({
				name: 'create_project',
				arguments: { root: tmpdir(), name: 'Elsewhere' },
			});
			assert.equal(outOfScope.isError, true);
			assert.equal(outOfScope.structuredContent?.error?.code, 'out_of_scope');
			// A terminal outside this capability's reach is refused before the
			// Ask First prompt for managing terminals.
			const elsewhere = await client.callTool({
				name: 'write_terminal',
				arguments: { terminal: 'not-in-this-project', text: 'x' },
			});
			assert.equal(elsewhere.isError, true);
			assert.equal(
				elsewhere.structuredContent?.error?.code,
				'terminal_not_found',
			);

			// Ask First: the call waits for a person. Nobody answers here, so it
			// is still waiting when the client goes away.
			let settled = false;
			client.callTool({ name: 'open_terminal', arguments: {} }).then(
				() => {
					settled = true;
				},
				() => undefined,
			);
			await new Promise((resolve) => setTimeout(resolve, 500));
			assert.equal(settled, false, 'an Ask First tool waits for approval');
		} finally {
			await client.close();
		}
	} finally {
		await server.stop();
	}
});

test('a standalone server with Terminay MCP off gives its terminals no capability', {
	skip: process.platform === 'win32',
}, async () => {
	const server = await startServer({ terminayMcp: { enabled: false } });
	try {
		const env = await server.terminalEnvironment();
		assert.equal(env.TERMINAY_CONTROL_TOKEN, undefined);
		assert.equal(env.TERMINAY_CONTROL_SOCKET, undefined);
	} finally {
		await server.stop();
	}
});

test('a standalone server whose control socket has nowhere to go stops with the reason', {
	skip: process.platform === 'win32',
}, async () => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-mcp-placement-'));
	try {
		// A runtime directory that is not a directory cannot hold the socket,
		// and the data directory path is far too long for a socket either.
		const runtime = join(root, 'not-a-directory');
		await writeFile(runtime, '');
		const dataRoot = join(root, 'd'.repeat(120), 'e'.repeat(120));
		await mkdir(dataRoot, { recursive: true });
		const child = spawn(
			process.execPath,
			[
				'dist/cli.js',
				'--server-id',
				'mcp-placement',
				'--data-root',
				dataRoot,
				'--project-root',
				root,
				'--endpoint',
				'disabled',
				'--agent-integration',
				'disabled',
				'--vault-unlock-fd',
				'3',
			],
			{
				cwd: packageRoot,
				env: {
					...process.env,
					HOME: root,
					TMPDIR: join(root, 't'.repeat(120)),
					XDG_RUNTIME_DIR: runtime,
					TERMINAY_SERVER_VERSION: 'test',
				},
				stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
			},
		);
		child.stdio[3].end('test-vault-passphrase\n');
		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		const [code] = await once(child, 'exit');
		assert.notEqual(code, 0);
		assert.equal(stdout, '', 'no readiness line was printed');
		assert.match(stderr, /path too long for a local socket/);
		// It stopped before the Git command socket, which shares the data
		// directory, was ever placed.
		assert.doesNotMatch(stderr, /git command/i);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

function countSessions(result) {
	return (JSON.stringify(result.content).match(/"status\\?":\\?"/g) ?? [])
		.length;
}

async function connectMcp(env) {
	const client = new Client({ name: 'standalone-mcp-test', version: '1.0.0' });
	await client.connect(
		new StdioClientTransport({
			command: process.execPath,
			args: [mcpEntry],
			env: {
				PATH: process.env.PATH ?? '',
				TERMINAY_CONTROL_SOCKET: env.TERMINAY_CONTROL_SOCKET,
				TERMINAY_CONTROL_TOKEN: env.TERMINAY_CONTROL_TOKEN,
			},
		}),
	);
	return client;
}

async function startServer(settings = {}) {
	const root = await mkdtemp(join(tmpdir(), 'terminay-mcp-'));
	const dataRoot = join(root, 'data');
	const envFile = join(root, 'terminal-env.json');
	const shell = join(root, 'shell.sh');
	await mkdir(dataRoot, { recursive: true });
	// The terminal's shell records the environment it was started with and
	// then stays running.
	await writeFile(
		shell,
		`#!/bin/sh\n"${process.execPath}" -e 'require("fs").writeFileSync(process.argv[1] + ".tmp", JSON.stringify(process.env)); require("fs").renameSync(process.argv[1] + ".tmp", process.argv[1])' "${envFile}"\nexec sleep 600\n`,
	);
	await chmod(shell, 0o755);
	await writeFile(
		join(dataRoot, 'settings.v1.json'),
		JSON.stringify({
			shell: { program: '/bin/sh', startupMode: 'non-login', extraArgs: shell },
			...settings,
		}),
	);
	const child = spawn(
		process.execPath,
		[
			'dist/cli.js',
			'--server-id',
			'standalone-mcp',
			'--data-root',
			dataRoot,
			'--project-root',
			root,
			'--endpoint',
			'disabled',
			'--agent-integration',
			'disabled',
			'--vault-unlock-fd',
			'3',
		],
		{
			cwd: packageRoot,
			env: {
				...process.env,
				HOME: root,
				TERMINAY_SERVER_VERSION: 'test',
				// What started the server may itself be a Terminay terminal. Its
				// socket and token are never this server's terminals' to have.
				TERMINAY_CONTROL_SOCKET: INHERITED_SOCKET,
				TERMINAY_CONTROL_TOKEN: INHERITED_TOKEN,
			},
			stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
		},
	);
	child.stdio[3].end('test-vault-passphrase\n');
	const ready = await readiness(child);
	assert.equal(ready.ready, true);
	return {
		async terminalEnvironment() {
			// The default terminal is started during startup; its shell writes the
			// file once it runs. Bounded by the test timeout.
			for (;;) {
				try {
					return JSON.parse(await readFile(envFile, 'utf8'));
				} catch {
					await new Promise((resolve) => setTimeout(resolve, 50));
				}
			}
		},
		async stop() {
			if (child.exitCode === null && child.signalCode === null) {
				child.kill('SIGTERM');
				await once(child, 'exit');
			}
			await rm(root, { recursive: true, force: true });
		},
	};
}

async function readiness(child) {
	let stdout = '';
	let stderr = '';
	child.stdout.setEncoding('utf8');
	child.stderr.setEncoding('utf8');
	child.stderr.on('data', (chunk) => {
		stderr += chunk;
	});
	return new Promise((resolve, reject) => {
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
			const newline = stdout.indexOf('\n');
			if (newline < 0) return;
			try {
				resolve(JSON.parse(stdout.slice(0, newline)));
			} catch (error) {
				reject(error);
			}
		});
		child.once('error', reject);
		child.once('exit', (code, signal) =>
			reject(
				new Error(`CLI exited before readiness (${code ?? signal}): ${stderr}`),
			),
		);
	});
}
