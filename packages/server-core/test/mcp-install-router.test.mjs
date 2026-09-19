import assert from 'node:assert/strict';
import test from 'node:test';
import { McpInstallRouter } from '../dist/index.js';

const server = {
	command: '/Applications/Terminay.app/Contents/MacOS/Terminay',
	args: ['/entry.js'],
	env: { ELECTRON_RUN_AS_NODE: '1' },
};

function hosts(targets, handler) {
	return {
		mcpInstallTargetContributions: () =>
			targets.map((id) => ({
				extensionId: 'com.terminay.builtin-agents',
				contribution: { id, displayName: id.split('/')[1] },
			})),
		invokeMcpTarget: async (targetId, operation, command) =>
			handler(targetId, operation, command),
	};
}

test('status lists every target in declaration order, keyed by target id', async () => {
	const calls = [];
	const router = new McpInstallRouter({
		hosts: () =>
			hosts(
				[
					'com.terminay.builtin-agents/claude-code',
					'com.terminay.builtin-agents/codex',
				],
				(id, operation, command) => {
					calls.push([id, operation, command]);
					return id.endsWith('codex')
						? { state: 'installed', configPath: '/home/.codex/config.toml' }
						: { state: 'not-installed', configPath: '/home/.claude.json' };
				},
			),
		serverCommand: () => server,
	});
	const status = await router.status();
	assert.equal(status.state, 'ready');
	assert.deepEqual(
		status.agents.map(({ id, state, installed }) => ({ id, state, installed })),
		[
			{
				id: 'com.terminay.builtin-agents/claude-code',
				state: 'not-installed',
				installed: false,
			},
			{
				id: 'com.terminay.builtin-agents/codex',
				state: 'installed',
				installed: true,
			},
		],
	);
	assert.ok(
		calls.every(
			([, operation, command]) => operation === 'status' && command === server,
		),
	);
});

test("install and uninstall route to the named target with the host's command", async () => {
	const calls = [];
	const router = new McpInstallRouter({
		hosts: () =>
			hosts(['com.terminay.builtin-agents/grok'], (id, operation, command) => {
				calls.push([id, operation, command.command]);
				return { ok: true, installed: operation === 'install' };
			}),
		serverCommand: () => server,
	});
	assert.deepEqual(await router.install('com.terminay.builtin-agents/grok'), {
		ok: true,
		installed: true,
	});
	assert.deepEqual(await router.uninstall('com.terminay.builtin-agents/grok'), {
		ok: true,
		installed: false,
	});
	assert.deepEqual(calls, [
		['com.terminay.builtin-agents/grok', 'install', server.command],
		['com.terminay.builtin-agents/grok', 'uninstall', server.command],
	]);
});

test('an unknown target is refused without calling any extension', async () => {
	let called = false;
	const router = new McpInstallRouter({
		hosts: () =>
			hosts(['com.terminay.builtin-agents/grok'], () => {
				called = true;
			}),
		serverCommand: () => server,
	});
	const result = await router.install('com.terminay.builtin-agents/nope');
	assert.equal(result.ok, false);
	assert.equal(called, false);
});

test('no registered targets (extension disabled) reports an empty no-targets state', async () => {
	const router = new McpInstallRouter({
		hosts: () => hosts([], () => ({})),
		serverCommand: () => server,
	});
	assert.deepEqual(await router.status(), { state: 'no-targets', agents: [] });
});

test('a server without an MCP command reports every target unavailable and writes nothing', async () => {
	let called = false;
	const router = new McpInstallRouter({
		hosts: () =>
			hosts(['com.terminay.builtin-agents/codex'], () => {
				called = true;
			}),
	});
	const status = await router.status();
	assert.equal(status.state, 'unavailable');
	assert.equal(status.agents[0].state, 'unavailable');
	assert.equal(
		(await router.install('com.terminay.builtin-agents/codex')).ok,
		false,
	);
	assert.equal(called, false);
});

test('a failing target reads as an error row, not a failed status', async () => {
	const router = new McpInstallRouter({
		hosts: () =>
			hosts(['com.terminay.builtin-agents/codex'], () => {
				throw new Error('boom\nline');
			}),
		serverCommand: () => server,
	});
	const status = await router.status();
	assert.equal(status.agents[0].state, 'error');
	assert.equal(status.agents[0].message, 'boom line');
});
