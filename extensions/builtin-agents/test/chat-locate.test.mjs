import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAgentLocator } from '../dist/index.js';

async function home(t) {
	const directory = await mkdtemp(join(tmpdir(), 'builtin-agents-locate-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	return directory;
}

async function executable(path) {
	await mkdir(join(path, '..'), { recursive: true });
	await writeFile(path, '#!/bin/sh\nexit 0\n');
	await chmod(path, 0o755);
	return path;
}

test('an absolute override wins, and a relative one finds nothing', async (t) => {
	const root = await home(t);
	const claude = await executable(join(root, 'custom', 'claude'));
	await executable(join(root, 'bin', 'claude'));
	const env = { PATH: join(root, 'bin'), TERMINAY_CLAUDE_CODE_COMMAND: claude };
	assert.equal(
		await createAgentLocator({ env, homeDirectory: root }).locate('claude'),
		claude,
	);
	const relative = {
		PATH: join(root, 'bin'),
		TERMINAY_CLAUDE_CODE_COMMAND: 'claude',
	};
	assert.equal(
		await createAgentLocator({
			env: relative,
			homeDirectory: root,
			loginShellPath: async () => undefined,
		}).locate('claude'),
		undefined,
	);
});

test('PATH is searched before the login shell, which is read once', async (t) => {
	const root = await home(t);
	const codex = await executable(join(root, 'bin', 'codex'));
	const loginOnly = await executable(join(root, 'login', 'claude'));
	let reads = 0;
	const locator = createAgentLocator({
		env: { PATH: join(root, 'bin') },
		homeDirectory: root,
		loginShellPath: async () => {
			reads += 1;
			return join(root, 'login');
		},
	});
	assert.equal(await locator.locate('codex'), codex);
	assert.equal(reads, 0);
	assert.equal(await locator.locate('claude'), loginOnly);
	assert.equal(await locator.locate('claude'), loginOnly);
	assert.equal(reads, 1);
});

test('a Dock-launched PATH still finds per-user installs', async (t) => {
	const root = await home(t);
	const claude = await executable(join(root, '.local', 'bin', 'claude'));
	const codex = await executable(
		join(root, '.nvm', 'versions', 'node', 'v24.14.0', 'bin', 'codex'),
	);
	await executable(
		join(root, '.nvm', 'versions', 'node', 'v9.0.0', 'bin', 'codex'),
	);
	const locator = createAgentLocator({
		env: { PATH: '/usr/bin:/bin' },
		homeDirectory: root,
		loginShellPath: async () => '/usr/bin:/bin',
	});
	assert.equal(await locator.locate('claude'), claude);
	assert.equal(await locator.locate('codex'), codex);
});

test('a non-executable file is not an agent', async (t) => {
	const root = await home(t);
	await mkdir(join(root, 'bin'));
	await writeFile(join(root, 'bin', 'codex'), 'not executable');
	const locator = createAgentLocator({
		env: { PATH: join(root, 'bin') },
		homeDirectory: root,
		loginShellPath: async () => undefined,
	});
	assert.equal(await locator.locate('codex'), undefined);
});
