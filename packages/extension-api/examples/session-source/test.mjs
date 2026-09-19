import assert from 'node:assert/strict';
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	unlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	createAgentExtensionHarness,
	fixtureMcpServerCommand,
} from '@terminay/extension-api/testing';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
	await readFile(join(here, 'package.json'), 'utf8'),
).terminay;
const loaded = await import(pathToFileURL(join(here, 'extension.js')));

async function exampleHome(t) {
	const home = await mkdtemp(join(tmpdir(), 'example-agent-'));
	await mkdir(join(home, 'sessions'));
	process.env.EXAMPLE_AGENT_HOME = home;
	t.after(() => rm(home, { recursive: true, force: true }));
	return home;
}

test('example source reports live sessions, their changes, and their exit', async (t) => {
	const home = await exampleHome(t);
	await writeFile(
		join(home, 'sessions', '101.json'),
		JSON.stringify({
			id: 'sess-1',
			cwd: '/work/app',
			title: 'Fix tests',
			status: 'running',
		}),
	);
	const harness = await createAgentExtensionHarness(loaded.default, {
		manifest,
	});
	t.after(() => harness.dispose());

	await harness.start();
	assert.deepEqual(
		harness
			.sessions()
			.map((session) => [session.id, session.pid, session.status]),
		[['sess-1', 101, 'running']],
	);

	await writeFile(
		join(home, 'sessions', '101.json'),
		JSON.stringify({
			id: 'sess-1',
			cwd: '/work/app',
			title: 'Fix tests',
			status: 'idle',
		}),
	);
	await harness.waitFor((h) => h.sessions()[0]?.status === 'idle');

	await unlink(join(home, 'sessions', '101.json'));
	await harness.waitFor((h) => h.sessions().length === 0);
	harness.assertConformant();
});

test('switching the harness off clears it; switching it back on reports it again', async (t) => {
	const home = await exampleHome(t);
	await writeFile(
		join(home, 'sessions', '7.json'),
		JSON.stringify({ id: 'sess-7', cwd: '/work/app' }),
	);
	const harness = await createAgentExtensionHarness(loaded.default, {
		manifest,
	});
	t.after(() => harness.dispose());
	await harness.start();
	harness.setEnabledHarnesses([]);
	await harness.waitFor(
		(h) =>
			h.publications().at(-1)?.kind === 'reset' &&
			h.publications().at(-1).sessions.length === 0,
	);
	harness.setEnabledHarnesses(['example-agent']);
	await harness.waitFor((h) => h.sessions().length === 1);
	harness.assertConformant();
});

test('example MCP target installs, detects, and removes the terminay entry', async (t) => {
	await exampleHome(t);
	const harness = await createAgentExtensionHarness(loaded.default, {
		manifest,
	});
	t.after(() => harness.dispose());
	const target = 'com.example.agent/example-agent';
	assert.equal((await harness.mcpStatus(target)).state, 'not-installed');
	assert.deepEqual(await harness.mcpInstall(target), {
		ok: true,
		installed: true,
	});
	assert.equal((await harness.mcpStatus(target)).state, 'installed');
	assert.equal(
		(
			await harness.mcpStatus(target, {
				...fixtureMcpServerCommand,
				args: ['other.js'],
			})
		).state,
		'changed',
	);
	assert.deepEqual(await harness.mcpUninstall(target), {
		ok: true,
		installed: false,
	});
	assert.equal((await harness.mcpStatus(target)).state, 'not-installed');
});
