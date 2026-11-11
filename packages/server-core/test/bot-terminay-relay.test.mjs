import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { nativeArguments } from '../dist/botService/native.js';
import { openBotRuntimeBridge } from '../dist/botService/runtimeBridge.js';

// A bot execution's `terminay` relay (ADR-0100), over the real container
// relay and adapter scripts.

const relay = fileURLToPath(new URL('./fixtures/bot-relay-host.py', import.meta.url));
const adapter = fileURLToPath(
	new URL('../../../docker/terminay-bot/bin/terminay-bot-mcp', import.meta.url),
);

function harness(t, options = {}) {
	const sid = randomBytes(12).toString('hex');
	const children = new Map();
	const killed = [];
	const secrets = new Map();
	const runtime = {
		bindSecret: (id, token, key = id) => {
			assert.equal(id, sid);
			secrets.set(key, token);
			return () => secrets.delete(key);
		},
		assert: () => {},
		assertWork: () => {},
		call: async () => ({}),
		sanitizeSecrets: (_bot, value) => value,
	};
	const driver = {
		execStream: (_container, command) => {
			const relayId = command[4];
			if (command[1].startsWith('mcp-terminay-') && options.terminayExecFails)
				throw new Error('engine refused the exec');
			const child = spawn('python3', [relay, relayId], { stdio: ['pipe', 'pipe', 'pipe'] });
			children.set(command[1], child);
			t.after(() => {
				child.kill();
				rmSync(`/tmp/terminay-mcp-${relayId}.sock`, { force: true });
			});
			return child;
		},
		exec: async (_container, command, execOptions) => {
			if (command[0] === '/usr/local/bin/terminay-bot-mcp') {
				// The exec env holds only what the bridge passed, as in a container.
				const terminayProbe = command.includes('--terminay-mcp');
				const probe = spawn(
					'python3',
					[terminayProbe ? (options.terminayAdapter ?? adapter) : adapter, ...command.slice(1)],
					{
						env: { PATH: process.env.PATH, ...execOptions.env },
						stdio: ['ignore', 'pipe', 'pipe'],
					},
				);
				const [code] = await once(probe, 'close');
				if (code !== 0) throw new Error(`probe exited ${code}`);
				return '';
			}
			killed.push(Object.assign([...command], { deadlineMs: execOptions?.deadlineMs }));
			const child = children.get(command[2]);
			if (child && child.exitCode === null) {
				const closed = once(child, 'close');
				child.stdin.end();
				await closed;
			}
			return '';
		},
	};
	return { sid, driver, runtime, killed, secrets };
}

function fakeHandler() {
	const seen = [];
	const closedConnections = [];
	let closed = 0;
	return {
		seen,
		closedConnections,
		closed: () => closed,
		handler: {
			handle(connection, message, reply) {
				seen.push({ connection, message });
				if (message.id === undefined) return;
				// Like the host's MCP server, refuse an initialize without its params.
				if (message.method === 'initialize' && (typeof message.params?.protocolVersion !== 'string' || typeof message.params?.clientInfo !== 'object'))
					return reply({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'Invalid initialize params' } });
				reply({
					jsonrpc: '2.0',
					id: message.id,
					result: {
						connection,
						echo: message.method,
						// Stands in for the workspace tool surface the host serves.
						...(message.method === 'tools/list' ? { tools: [{ name: 'list_projects' }, { name: 'open_terminal' }] } : {}),
					},
				});
			},
			closeConnection(connection) {
				closedConnections.push(connection);
			},
			close() {
				closed += 1;
			},
		},
	};
}

function client(t, environment, args = ['--terminay-mcp'], command = ['python3', adapter]) {
	const child = spawn(command[0], [...command.slice(1), ...args], {
		env: { PATH: process.env.PATH, ...environment },
		stdio: ['pipe', 'pipe', 'pipe'],
	});
	t.after(() => child.kill());
	const lines = createInterface({ input: child.stdout });
	const iterator = lines[Symbol.asyncIterator]();
	return {
		child,
		async request(id, method, params = {}) {
			child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
			const response = await iterator.next();
			return JSON.parse(response.value);
		},
		close() {
			child.stdin.end();
			lines.close();
		},
	};
}

const env = (server) => Object.fromEntries(server.env.map((e) => [e.name, e.value]));

test('with access, a terminay server is relayed to the host handler, per connection, under its own secret', { timeout: 20000 }, async (t) => {
	const h = harness(t);
	const fake = fakeHandler();
	const bridge = await openBotRuntimeBridge(h.driver, 'abc123def456', h.sid, h.runtime, undefined, () => fake.handler);
	const terminay = bridge.servers.find((server) => server.name === 'terminay');
	assert.ok(terminay, 'the terminay server is offered');
	const environment = env(terminay);
	const runtimeEnvironment = env(bridge.servers[0]);
	assert.deepEqual(terminay.args, ['--terminay-mcp']);
	assert.deepEqual(Object.keys(environment).sort(), ['BASH_ENV', 'TERMINAY_MCP_SOCKET', 'TERMINAY_MCP_TOKEN']);
	assert.notEqual(environment.TERMINAY_MCP_TOKEN, runtimeEnvironment.TERMINAY_RUNTIME_TOKEN);
	assert.notEqual(environment.TERMINAY_MCP_SOCKET, runtimeEnvironment.TERMINAY_RUNTIME_SOCKET);
	assert.equal(h.secrets.get(`${h.sid}:terminay`), environment.TERMINAY_MCP_TOKEN);
	// The agent process carries both pairs, under different names.
	assert.equal(bridge.environment.TERMINAY_MCP_TOKEN, environment.TERMINAY_MCP_TOKEN);
	assert.equal(bridge.environment.TERMINAY_RUNTIME_TOKEN, runtimeEnvironment.TERMINAY_RUNTIME_TOKEN);

	const first = client(t, environment);
	const second = client(t, environment);
	const a = await first.request(1, 'tools/list');
	const b = await second.request(1, 'tools/list');
	assert.equal(a.id, 1);
	assert.equal(b.id, 1);
	assert.notEqual(a.result.connection, b.result.connection, 'each adapter is its own connection');

	// The relay reports a disconnect, so only that connection's session ends.
	// The startup probe's own connection has already come and gone.
	const probed = fake.closedConnections.length;
	first.close();
	await once(first.child, 'close');
	for (let i = 0; i < 50 && fake.closedConnections.length === probed; i++)
		await new Promise((resolve) => setTimeout(resolve, 20));
	assert.deepEqual(fake.closedConnections.slice(probed), [a.result.connection]);
	assert.equal((await second.request(2, 'tools/list')).result.connection, b.result.connection);

	// A wrong secret never reaches the handler.
	const before = fake.seen.length;
	const intruder = client(t, { ...environment, TERMINAY_MCP_TOKEN: 'f'.repeat(64) });
	const refused = await intruder.request(9, 'tools/list');
	assert.match(refused.error.message, /refused/);
	assert.equal(fake.seen.length, before);

	// The relay secret is redacted like the runtime's, even split across chunks.
	const secret = environment.TERMINAY_MCP_TOKEN;
	const wrapped = bridge.wrapCredential({
		environment: {},
		redact: (value) => value,
		stream: () => ({ push: (value) => value, finish: () => '' }),
		release: () => {},
	});
	assert.equal(wrapped.redact(`x=${secret}`), 'x=[redacted]');
	const stream = wrapped.stream();
	assert.equal(stream.push(secret.slice(0, 20)) + stream.push(secret.slice(20)) + stream.finish(), '[redacted]');

	second.close();
	intruder.close();
	await bridge.close();
	assert.equal(fake.closed(), 1, 'closing the bridge ends the handler');
	assert.equal(h.secrets.has(`${h.sid}:terminay`), false);
	assert.ok(h.killed.some((command) => command[1] === '--kill' && command[2].startsWith('mcp-terminay-')));
	for (const command of h.killed.filter((c) => c[1] === '--kill')) assert.equal(command.deadlineMs, 5 * 60_000);
});

test('without access there is no terminay server and no second relay', { timeout: 15000 }, async (t) => {
	const h = harness(t);
	const bridge = await openBotRuntimeBridge(h.driver, 'abc123def456', h.sid, h.runtime);
	assert.equal(bridge.servers.some((server) => server.name === 'terminay'), false);
	assert.equal(Object.keys(bridge.environment).some((name) => name.startsWith('TERMINAY_MCP_')), false);
	await bridge.close();
	const none = harness(t);
	const declined = await openBotRuntimeBridge(none.driver, 'abc123def456', none.sid, none.runtime, undefined, () => undefined);
	assert.equal(declined.servers.some((server) => server.name === 'terminay'), false);
	assert.equal(none.secrets.has(`${none.sid}:terminay`), false);
	await declined.close();
});

test('when the second relay cannot start, the execution runs without terminay and nothing is left behind', { timeout: 15000 }, async (t) => {
	const h = harness(t, { terminayExecFails: true });
	const fake = fakeHandler();
	const diagnostics = [];
	const bridge = await openBotRuntimeBridge(
		h.driver,
		'abc123def456',
		h.sid,
		h.runtime,
		(value) => diagnostics.push(value),
		() => fake.handler,
	);
	assert.equal(bridge.servers.some((server) => server.name === 'terminay'), false);
	assert.equal(fake.closed(), 1, 'the minted capability is given up');
	assert.equal(h.secrets.has(`${h.sid}:terminay`), false);
	assert.ok(diagnostics.some((line) => /Terminay MCP is unavailable for this execution/.test(line)));
	await bridge.close();
});

// The agent launch path, joined end to end: the bridge's real servers and
// environment, the native launch arguments for each driver, and the real
// adapter. This is where a server once read the wrong relay's pair.

const toolShell = fileURLToPath(
	new URL('../../../docker/terminay-bot/bin/terminay-tool-shell', import.meta.url),
);
const beforeSelection = fileURLToPath(
	new URL('./fixtures/terminay-bot-mcp-before-selection.py', import.meta.url),
);

/** What Codex gives each MCP server: its literal env plus its `env_vars`. */
function codexServers(args, agentEnvironment) {
	const values = new Map();
	for (let i = 0; i < args.length; i++)
		if (args[i] === '-c') {
			const [key, ...rest] = args[i + 1].split('=');
			values.set(key, rest.join('='));
		}
	const names = new Set(
		[...values.keys()].filter((k) => k.startsWith('mcp_servers.')).map((k) => k.split('.')[1]),
	);
	return Object.fromEntries(
		[...names].map((name) => {
			const at = (field) => values.get(`mcp_servers.${name}.${field}`);
			const environment = {};
			for (const forwarded of JSON.parse(at('env_vars') ?? '[]'))
				environment[forwarded] = agentEnvironment[forwarded];
			for (const [key, value] of values)
				if (key.startsWith(`mcp_servers.${name}.env.`))
					environment[key.slice(`mcp_servers.${name}.env.`.length)] = JSON.parse(value);
			return [name, { command: JSON.parse(at('command')), args: JSON.parse(at('args')), environment }];
		}),
	);
}

/** A copy of the shipped tool shell that execs the host's adapter. */
function hostToolShell(directory, target = `python3 '${adapter}'`) {
	const file = join(directory, 'terminay-tool-shell');
	writeFileSync(
		file,
		readFileSync(toolShell, 'utf8').replaceAll('exec /usr/local/bin/terminay-bot-mcp', `exec ${target}`),
	);
	return file;
}

async function listTools(t, environment, args, command) {
	const c = client(t, environment, args, command);
	await c.request(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } });
	const listed = await c.request(2, 'tools/list');
	c.close();
	return (listed.result?.tools ?? []).map((tool) => tool.name);
}

for (const driver of ['codex-cli', 'claude-code-cli']) {
	test(`a ${driver} bot reaches workspace tools on terminay and runtime tools on terminay_bot`, { timeout: 20000 }, async (t) => {
		const h = harness(t);
		const fake = fakeHandler();
		const bridge = await openBotRuntimeBridge(h.driver, 'abc123def456', h.sid, h.runtime, undefined, () => fake.handler);
		t.after(() => bridge.close());
		const args = nativeArguments(driver, null, 'autonomous', bridge.servers, false);
		const agentEnvironment = { PATH: process.env.PATH, ...bridge.environment };
		const argv = JSON.stringify(args);
		for (const secret of [bridge.environment.TERMINAY_RUNTIME_TOKEN, bridge.environment.TERMINAY_MCP_TOKEN])
			assert.equal(argv.includes(secret), false, 'no secret on the command line');

		let launches;
		if (driver === 'codex-cli') {
			const servers = codexServers(args, agentEnvironment);
			assert.deepEqual(Object.keys(servers.terminay.environment).sort(), ['BASH_ENV', 'TERMINAY_MCP_SOCKET', 'TERMINAY_MCP_TOKEN']);
			assert.deepEqual(Object.keys(servers.terminay_bot.environment).sort(), ['BASH_ENV', 'TERMINAY_RUNTIME_SOCKET', 'TERMINAY_RUNTIME_TOKEN']);
			assert.deepEqual(Object.keys(servers.terminay_desktop.environment), []);
			launches = Object.fromEntries(
				['terminay', 'terminay_bot'].map((name) => [
					name,
					{ environment: { PATH: process.env.PATH, ...servers[name].environment }, args: servers[name].args, command: ['python3', adapter] },
				]),
			);
		} else {
			const config = JSON.parse(args[args.indexOf('--mcp-config') + 1]);
			assert.equal(JSON.stringify(config).includes('TERMINAY_'), false, 'no TERMINAY_ values in the MCP config');
			// Claude launches every MCP server through the tool shell, with the
			// whole agent environment, as one command string.
			const directory = mkdtempSync(join(tmpdir(), 'tool-shell-'));
			t.after(() => rmSync(directory, { recursive: true, force: true }));
			const shell = hostToolShell(directory);
			launches = Object.fromEntries(
				['terminay', 'terminay_bot'].map((name) => {
					const server = config.mcpServers[name];
					return [
						name,
						{
							environment: { ...agentEnvironment, ...server.env },
							args: [[server.command, ...server.args].join(' ')],
							command: ['/bin/sh', shell],
						},
					];
				}),
			);
		}
		const workspace = await listTools(t, launches.terminay.environment, launches.terminay.args, launches.terminay.command);
		const own = await listTools(t, launches.terminay_bot.environment, launches.terminay_bot.args, launches.terminay_bot.command);
		assert.ok(workspace.includes('list_projects') && workspace.includes('open_terminal'), `terminay lists ${workspace}`);
		assert.equal(workspace.includes('work_acquire'), false);
		assert.ok(own.includes('work_acquire'), `terminay_bot lists ${own}`);
		assert.equal(own.includes('list_projects'), false);
	});
}

/** Listens on a relay-shaped socket path and counts what reaches it. */
async function listener(t) {
	const path = `/tmp/terminay-mcp-${randomBytes(12).toString('hex')}.sock`;
	const seen = { connections: 0, bytes: 0 };
	const server = createServer((socket) => {
		seen.connections += 1;
		socket.on('data', (bytes) => (seen.bytes += bytes.length));
	});
	await new Promise((resolve) => server.listen(path, resolve));
	t.after(() => {
		server.close();
		rmSync(path, { force: true });
	});
	return { path, seen };
}

async function run(file, args, environment) {
	const child = spawn('python3', [file, ...args], {
		env: { PATH: process.env.PATH, ...environment },
		stdio: ['pipe', 'pipe', 'pipe'],
	});
	child.stdin.end();
	const [code] = await once(child, 'close');
	await new Promise((resolve) => setTimeout(resolve, 50));
	return code;
}

test('an adapter whose own pair is missing or malformed never falls back to the other', { timeout: 15000 }, async (t) => {
	const runtime = await listener(t);
	const workspace = await listener(t);
	const valid = {
		TERMINAY_RUNTIME_SOCKET: runtime.path,
		TERMINAY_RUNTIME_TOKEN: 'a'.repeat(64),
		TERMINAY_MCP_SOCKET: workspace.path,
		TERMINAY_MCP_TOKEN: 'b'.repeat(64),
	};
	for (const [args, broken] of [
		[['--terminay-mcp'], { TERMINAY_MCP_SOCKET: undefined }],
		[['--terminay-mcp'], { TERMINAY_MCP_TOKEN: 'short' }],
		[['--terminay-mcp'], { TERMINAY_MCP_SOCKET: '/tmp/elsewhere.sock' }],
		[[], { TERMINAY_RUNTIME_TOKEN: undefined }],
		[[], { TERMINAY_RUNTIME_SOCKET: '/tmp/elsewhere.sock' }],
		[['--terminay-mcp', '--extra'], {}],
		[['--other'], {}],
	]) {
		const environment = { ...valid, ...broken };
		for (const key of Object.keys(environment)) if (environment[key] === undefined) delete environment[key];
		assert.notEqual(await run(adapter, args, environment), 0, `${args} with ${JSON.stringify(broken)}`);
	}
	assert.deepEqual(runtime.seen, { connections: 0, bytes: 0 });
	assert.deepEqual(workspace.seen, { connections: 0, bytes: 0 });
});

test('an adapter from before pair selection sends nothing to the runtime relay', { timeout: 15000 }, async (t) => {
	const runtime = await listener(t);
	const workspace = await listener(t);
	const code = await run(beforeSelection, ['--terminay-mcp'], {
		TERMINAY_RUNTIME_SOCKET: runtime.path,
		TERMINAY_RUNTIME_TOKEN: 'a'.repeat(64),
		TERMINAY_MCP_SOCKET: workspace.path,
		TERMINAY_MCP_TOKEN: 'b'.repeat(64),
	});
	assert.notEqual(code, 0);
	assert.equal(runtime.seen.bytes, 0, 'no MCP frame reaches the runtime relay');
	assert.deepEqual(workspace.seen, { connections: 0, bytes: 0 });
});

test('on an image whose adapter cannot select its pair, the execution runs without terminay and says the image may be out of date', { timeout: 15000 }, async (t) => {
	const h = harness(t, { terminayAdapter: beforeSelection });
	const fake = fakeHandler();
	const diagnostics = [];
	const bridge = await openBotRuntimeBridge(h.driver, 'abc123def456', h.sid, h.runtime, (line) => diagnostics.push(line), () => fake.handler);
	assert.equal(bridge.servers.some((server) => server.name === 'terminay'), false);
	assert.equal(Object.keys(bridge.environment).some((name) => name.startsWith('TERMINAY_MCP_')), false);
	assert.equal(fake.closed(), 1, 'the minted capability is given up');
	assert.equal(h.secrets.has(`${h.sid}:terminay`), false);
	assert.ok(diagnostics.some((line) => /Terminay MCP is unavailable.*bot image may be out of date/.test(line)), diagnostics.join('\n'));
	await bridge.close();
});

test('the tool shell gives each adapter only its own pair and refuses every other form', { timeout: 15000 }, async (t) => {
	const directory = mkdtempSync(join(tmpdir(), 'tool-shell-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	// A stub that prints its environment stands in for the adapter.
	const stub = join(directory, 'print-env');
	writeFileSync(stub, 'exec env\n');
	const shell = hostToolShell(directory, `/bin/sh '${stub}'`);
	const environment = {
		PATH: process.env.PATH,
		TERMINAY_RUNTIME_SOCKET: '/tmp/terminay-mcp-runtime.sock',
		TERMINAY_RUNTIME_TOKEN: 'a'.repeat(64),
		TERMINAY_MCP_SOCKET: '/tmp/terminay-mcp-workspace.sock',
		TERMINAY_MCP_TOKEN: 'b'.repeat(64),
	};
	const launch = async (command) => {
		const child = spawn('/bin/sh', [shell, command], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
		let output = '';
		child.stdout.on('data', (b) => (output += b));
		const [code] = await once(child, 'close');
		return { code, names: output.split('\n').map((line) => line.split('=')[0]) };
	};
	for (const form of [
		'/usr/local/bin/terminay-bot-mcp --terminay-mcp',
		`'/usr/local/bin/terminay-bot-mcp' --terminay-mcp`,
		`"/usr/local/bin/terminay-bot-mcp" --terminay-mcp`,
		`'/usr/local/bin/terminay-bot-mcp' '--terminay-mcp'`,
	]) {
		const { code, names } = await launch(form);
		assert.equal(code, 0, form);
		assert.ok(names.includes('TERMINAY_MCP_TOKEN'), form);
		assert.equal(names.includes('TERMINAY_RUNTIME_TOKEN') || names.includes('TERMINAY_RUNTIME_SOCKET'), false, form);
	}
	const runtime = await launch('/usr/local/bin/terminay-bot-mcp');
	assert.equal(runtime.code, 0);
	assert.ok(runtime.names.includes('TERMINAY_RUNTIME_TOKEN'));
	assert.equal(runtime.names.includes('TERMINAY_MCP_TOKEN') || runtime.names.includes('TERMINAY_MCP_SOCKET'), false);
	// Any other form falls through to the work gate, which refuses without a
	// runtime adapter on this host.
	for (const form of [
		'/usr/local/bin/terminay-bot-mcp --terminay-mcp --extra',
		'/usr/local/bin/terminay-bot-mcp --terminay-mcp; printf bypass',
		'env /usr/local/bin/terminay-bot-mcp --terminay-mcp',
	])
		assert.notEqual((await launch(form)).code, 0, form);
});
