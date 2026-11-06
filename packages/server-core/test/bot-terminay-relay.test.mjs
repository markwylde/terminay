import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
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
				const probe = spawn('python3', [adapter, '--check-runtime'], {
					env: { ...process.env, ...execOptions.env },
					stdio: ['ignore', 'pipe', 'pipe'],
				});
				const [code] = await once(probe, 'close');
				assert.equal(code, 0);
				return '';
			}
			killed.push(command);
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
				reply({ jsonrpc: '2.0', id: message.id, result: { connection, echo: message.method } });
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

function client(t, environment) {
	const child = spawn('python3', [adapter], {
		env: { ...process.env, ...environment },
		stdio: ['pipe', 'pipe', 'pipe'],
	});
	t.after(() => child.kill());
	const lines = createInterface({ input: child.stdout });
	const iterator = lines[Symbol.asyncIterator]();
	return {
		child,
		async request(id, method) {
			child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params: {} })}\n`);
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
	assert.notEqual(environment.TERMINAY_RUNTIME_TOKEN, runtimeEnvironment.TERMINAY_RUNTIME_TOKEN);
	assert.notEqual(environment.TERMINAY_RUNTIME_SOCKET, runtimeEnvironment.TERMINAY_RUNTIME_SOCKET);
	assert.equal(h.secrets.get(`${h.sid}:terminay`), environment.TERMINAY_RUNTIME_TOKEN);

	const first = client(t, environment);
	const second = client(t, environment);
	const a = await first.request(1, 'tools/list');
	const b = await second.request(1, 'tools/list');
	assert.equal(a.id, 1);
	assert.equal(b.id, 1);
	assert.notEqual(a.result.connection, b.result.connection, 'each adapter is its own connection');

	// The relay reports a disconnect, so only that connection's session ends.
	first.close();
	await once(first.child, 'close');
	for (let i = 0; i < 50 && fake.closedConnections.length === 0; i++)
		await new Promise((resolve) => setTimeout(resolve, 20));
	assert.deepEqual(fake.closedConnections, [a.result.connection]);
	assert.equal((await second.request(2, 'tools/list')).result.connection, b.result.connection);

	// A wrong secret never reaches the handler.
	const before = fake.seen.length;
	const intruder = client(t, { ...environment, TERMINAY_RUNTIME_TOKEN: 'f'.repeat(64) });
	const refused = await intruder.request(9, 'tools/list');
	assert.match(refused.error.message, /refused/);
	assert.equal(fake.seen.length, before);

	// The relay secret is redacted like the runtime's, even split across chunks.
	const secret = environment.TERMINAY_RUNTIME_TOKEN;
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
});

test('without access there is no terminay server and no second relay', { timeout: 15000 }, async (t) => {
	const h = harness(t);
	const bridge = await openBotRuntimeBridge(h.driver, 'abc123def456', h.sid, h.runtime);
	assert.equal(bridge.servers.some((server) => server.name === 'terminay'), false);
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
