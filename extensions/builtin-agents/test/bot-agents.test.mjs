import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateExtensionManifest } from '@terminay/extension-api';
import { createAgentExtensionHarness } from '@terminay/extension-api/testing';
import {
	BOT_AGENT_IDS,
	createBotAgent,
	createBuiltInAgentsExtension,
} from '../dist/index.js';

const manifest = JSON.parse(
	await readFile(new URL('../package.json', import.meta.url), 'utf8'),
).terminay;
const signal = () => new AbortController().signal;

test('3.1 manifest validates and README records exact adapter pins', async () => {
	const result = validateExtensionManifest(manifest);
	assert.equal(result.ok, true, JSON.stringify(result));
	const readme = await readFile(
		new URL('../README.md', import.meta.url),
		'utf8',
	);
	for (const declaration of manifest.contributes.botAgents) {
		for (const pin of declaration.imageInstall.npm)
			assert.ok(readme.includes(pin));
	}
	const codex = manifest.contributes.botAgents.find(
		(a) => a.id === BOT_AGENT_IDS.codex,
	);
	// Codex signs in per bot, inside its container; no host file is shared.
	assert.deepEqual(codex.deviceSignIn.command, {
		executable: 'codex',
		args: ['login', '--device-auth'],
	});
	assert.equal(codex.credentialSecrets[0].authenticateMethodId, 'api-key');
	assert.equal(codex.autonomousOnly, true);
	assert.match(
		codex.botConfigFiles[0].contents,
		/cli_auth_credentials_store = "ephemeral"/,
	);
	assert.match(
		codex.botConfigFiles[0].contents,
		/exclude = \["CODEX_API_KEY", "OPENAI_API_KEY"\]/,
	);
	const claude = manifest.contributes.botAgents.find(
		(a) => a.id === BOT_AGENT_IDS.claude,
	);
	assert.equal(claude.autonomousOnly, false);
	assert.equal(claude.launchEnvironment.CLAUDE_CODE_MAX_RETRIES, '0');
	assert.equal(
		claude.launchEnvironment.CLAUDE_CODE_SHELL_PREFIX,
		'/usr/local/bin/terminay-tool-shell',
	);
	assert.deepEqual(codex.deviceSignIn.signOutCommand, {
		executable: 'codex',
		args: ['logout'],
	});
	assert.match(
		codex.deviceSignIn.configFiles[0].contents,
		/cli_auth_credentials_store = "file"/,
	);
	assert.match(
		codex.deviceSignIn.configFiles[0].contents,
		/exclude = \["CODEX_API_KEY", "OPENAI_API_KEY"\]/,
	);
	assert.equal(claude.deviceSignIn, undefined);
	assert.match(claude.credentialSecrets[0].help, /claude setup-token/);
});

for (const agent of ['claude', 'codex']) {
	test(`3.2 ${agent}: model list and launch use ACP configuration`, async () => {
		const runtime = createBotAgent(agent);
		const models = await runtime.models(signal());
		assert.ok(models.length > 0 && models.length <= 64);
		const gate = JSON.parse(
			await readFile(
				new URL(
					'../../../openspec/adr/evidence/0089-bots/acp-docker-linux.json',
					import.meta.url,
				),
				'utf8',
			),
		);
		const accepted = gate[agent].config_options.find(
			(o) => o.category === 'model',
		).values;
		assert.ok(models.every((m) => accepted.includes(m.id)));
		const first = models[0].id;
		models[0].id = 'mutated';
		assert.equal((await runtime.models(signal()))[0].id, first);
		for (const modelId of [null, first])
			assert.deepEqual(await runtime.launch({ modelId }, signal()), {
				args: [],
				env: {},
			});
		const aborted = AbortSignal.abort();
		await assert.rejects(runtime.models(aborted), { name: 'AbortError' });
		await assert.rejects(runtime.status(aborted), { name: 'AbortError' });
		await assert.rejects(runtime.launch({ modelId: null }, aborted), {
			name: 'AbortError',
		});
	});
}

for (const agent of ['claude', 'codex']) {
	test(`3.2 ${agent} bot status is independent of server account credentials`, async () => {
		assert.deepEqual(await createBotAgent(agent).status(signal()), {
			state: 'ready',
		});
	});
}

test('bot agents register independently and dispose with the extension', async (t) => {
	const harness = await createAgentExtensionHarness(
		createBuiltInAgentsExtension(),
		{ manifest },
	);
	t.after(() => harness.dispose());
	assert.deepEqual(
		harness.registeredBotAgentIds(),
		Object.values(BOT_AGENT_IDS),
	);
	for (const id of Object.values(BOT_AGENT_IDS)) {
		assert.equal((await harness.botAgentModels(id)).available, true);
		assert.deepEqual(await harness.botAgentLaunch(id, { modelId: null }), {
			available: true,
			value: { args: [], env: {} },
		});
	}
	await harness.dispose();
	assert.deepEqual(harness.registeredBotAgentIds(), []);
});
