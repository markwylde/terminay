import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExtensionHost } from '../dist/index.js';

const DEFAULT_ID = 'example.defaults/echo';

async function fixture(
	resolveBody,
	permissions = ['terminal-command-defaults'],
	command = 'echo-agent',
) {
	const root = await mkdtemp(join(tmpdir(), 'terminay-command-default-'));
	await writeFile(
		join(root, 'extension.js'),
		`export function activate(context) {
  context.terminals.registerCommandDefault("${DEFAULT_ID}", {
    async resolve() { ${resolveBody} },
  });
}`,
		{ mode: 0o600 },
	);
	for (const name of ['config', 'data', 'cache']) await mkdir(join(root, name));
	return {
		extensionId: 'example.defaults',
		packageRoot: root,
		entrypoint: 'extension.js',
		configDirectory: join(root, 'config'),
		dataDirectory: join(root, 'data'),
		cacheDirectory: join(root, 'cache'),
		permissions,
		terminalCommandDefaults: [{ id: DEFAULT_ID, command }],
	};
}

function host(t, limits) {
	const value = new ExtensionHost('example.defaults', {
		broker: { async request() {} },
		...(limits === undefined ? {} : { limits }),
	});
	t.after(() => value.stop());
	return value;
}

test('a command default registers and reports its flags, and nothing more', async (t) => {
	const value = host(t);
	await value.start(
		await fixture(
			`return { applies: true, args: ["--no-daemon"], command: "rm", shell: "x" };`,
		),
	);
	assert.deepEqual(
		value
			.status()
			.terminalCommandDefaults.map((entry) => [entry.id, entry.command]),
		[[DEFAULT_ID, 'echo-agent']],
	);
	assert.deepEqual(await value.resolveTerminalCommandDefault(DEFAULT_ID), {
		applies: true,
		args: ['--no-daemon'],
	});
});

test('an argument that is not a flag is refused', async (t) => {
	const value = host(t);
	await value.start(await fixture(`return { applies: true, args: ["exec"] };`));
	await assert.rejects(value.resolveTerminalCommandDefault(DEFAULT_ID));
});

test('a resolution that throws or never answers fails', async (t) => {
	const thrower = host(t);
	await thrower.start(await fixture(`throw new Error("boom");`));
	await assert.rejects(thrower.resolveTerminalCommandDefault(DEFAULT_ID));
	const silent = host(t, { invocationTimeoutMs: 200 });
	await silent.start(await fixture(`await new Promise(() => {});`));
	const started = Date.now();
	await assert.rejects(silent.resolveTerminalCommandDefault(DEFAULT_ID));
	assert.ok(Date.now() - started < 5_000);
});

test('an unregistered command default is unavailable', async (t) => {
	const value = host(t);
	await value.start(
		await fixture(`return { applies: false, reason: "unsupported" };`),
	);
	await assert.rejects(
		value.resolveTerminalCommandDefault('example.defaults/other'),
		/unavailable/,
	);
});

test('a command default registered without terminal-command-defaults is refused', async () => {
	const value = new ExtensionHost('example.defaults', {
		broker: { async request() {} },
	});
	await assert.rejects(
		value.start(
			await fixture(`return { applies: false, reason: "unsupported" };`, [
				'agent-launch',
			]),
		),
		/invalid terminal command default registrations/,
	);
});
