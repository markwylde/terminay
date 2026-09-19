import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	createAgentExtensionHarness,
	fixtureMcpServerCommand,
} from '@terminay/extension-api/testing';
import { createBuiltInAgentsExtension } from '../dist/index.js';

const manifest = JSON.parse(
	await readFile(new URL('../package.json', import.meta.url), 'utf8'),
).terminay;
const target = (id) => `com.terminay.builtin-agents/${id}`;

async function harnessIn(t) {
	const home = await mkdtemp(join(tmpdir(), 'builtin-agents-mcp-'));
	t.after(() => rm(home, { recursive: true, force: true }));
	const harness = await createAgentExtensionHarness(
		createBuiltInAgentsExtension({ mcp: { homeDirectory: home } }),
		{ manifest },
	);
	t.after(() => harness.dispose());
	return { harness, home };
}

test('each target installs, detects, and removes exactly the host-supplied command', async (t) => {
	const { harness, home } = await harnessIn(t);
	const paths = {
		'claude-code': join(home, '.claude.json'),
		codex: join(home, '.codex', 'config.toml'),
		cursor: join(home, '.cursor', 'mcp.json'),
		gemini: join(home, '.gemini', 'settings.json'),
		grok: join(home, '.grok', 'config.toml'),
		opencode: join(home, '.config', 'opencode', 'opencode.json'),
	};
	for (const [id, configPath] of Object.entries(paths)) {
		assert.deepEqual(
			await harness.mcpStatus(target(id)),
			{ state: 'not-installed', configPath },
			id,
		);
		const installed = await harness.mcpInstall(target(id));
		assert.equal(installed.ok, true, id);
		assert.equal(installed.installed, true, id);
		assert.equal((await harness.mcpStatus(target(id))).state, 'installed', id);
		assert.equal(
			(
				await harness.mcpStatus(target(id), {
					...fixtureMcpServerCommand,
					args: ['/elsewhere/serverMcpEntry.js'],
				})
			).state,
			'changed',
			id,
		);
		const removed = await harness.mcpUninstall(target(id));
		assert.equal(removed.ok, true, id);
		assert.equal(removed.installed, false, id);
		assert.equal(
			(await harness.mcpStatus(target(id))).state,
			'not-installed',
			id,
		);
	}
});

test('the Claude Code target writes the host command and nothing else', async (t) => {
	const { harness, home } = await harnessIn(t);
	await harness.mcpInstall(target('claude-code'));
	const config = JSON.parse(await readFile(join(home, '.claude.json'), 'utf8'));
	assert.deepEqual(config.mcpServers.terminay, fixtureMcpServerCommand);
});

test('targets work while every harness is switched off', async (t) => {
	const { harness } = await harnessIn(t);
	await harness.start(undefined, { enabledHarnesses: [] });
	assert.equal((await harness.mcpInstall(target('codex'))).installed, true);
	assert.equal((await harness.mcpStatus(target('codex'))).state, 'installed');
});
