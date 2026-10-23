import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { validateExtensionManifest } from '@terminay/extension-api';
import { createAgentExtensionHarness } from '@terminay/extension-api/testing';
import {
	CLAUDE_CODE_LAUNCHER_ID,
	CODEX_LAUNCHER_ID,
	createBuiltInAgentsExtension,
} from '../dist/index.js';

const manifest = JSON.parse(
	await readFile(new URL('../package.json', import.meta.url), 'utf8'),
).terminay;

async function root(t) {
	const directory = await mkdtemp(join(tmpdir(), 'builtin-agents-launch-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	return directory;
}

async function executable(path) {
	await mkdir(join(path, '..'), { recursive: true });
	await writeFile(path, '#!/bin/sh\nexit 0\n');
	await chmod(path, 0o755);
	return path;
}

async function harnessWith(t, env, homeDirectory) {
	const harness = await createAgentExtensionHarness(
		createBuiltInAgentsExtension({
			locator: { env, homeDirectory, loginShellPath: async () => undefined },
		}),
		{ manifest },
	);
	t.after(() => harness.dispose());
	return harness;
}

test('the manifest declares both launchers, Claude Code first, under agent-launch', () => {
	assert.equal(validateExtensionManifest(manifest).ok, true);
	assert.ok(manifest.permissions.includes('agent-launch'));
	assert.deepEqual(
		manifest.contributes.terminalLaunchers.map((launcher) => [
			launcher.id,
			launcher.icon,
			launcher.harness.harness,
		]),
		[
			[CLAUDE_CODE_LAUNCHER_ID, 'agent-claude-code', 'claude-code'],
			[CODEX_LAUNCHER_ID, 'agent-codex', 'codex'],
		],
	);
});

test('an installed agent resolves to its absolute path', async (t) => {
	const home = await root(t);
	const claude = await executable(join(home, '.local', 'bin', 'claude'));
	const harness = await harnessWith(t, { PATH: '/nonexistent' }, home);
	assert.deepEqual(harness.registeredLauncherIds(), [
		CLAUDE_CODE_LAUNCHER_ID,
		CODEX_LAUNCHER_ID,
	]);
	assert.deepEqual(await harness.resolveLauncher(CLAUDE_CODE_LAUNCHER_ID), {
		available: true,
		executable: claude,
	});
});

test('an agent that is not installed is reported not installed', async (t) => {
	const home = await root(t);
	const harness = await harnessWith(t, { PATH: '/nonexistent' }, home);
	const resolution = await harness.resolveLauncher(CODEX_LAUNCHER_ID);
	assert.equal(resolution.available, false);
	assert.equal(resolution.reason, 'not_installed');
});

test('the command override is honoured', async (t) => {
	const home = await root(t);
	const codex = await executable(join(home, 'custom', 'codex'));
	const harness = await harnessWith(
		t,
		{ PATH: '/nonexistent', TERMINAY_CODEX_COMMAND: codex },
		home,
	);
	assert.deepEqual(await harness.resolveLauncher(CODEX_LAUNCHER_ID), {
		available: true,
		executable: codex,
	});
});
