// Executed as bot inside a network-disabled image, never on the server account.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Acp } from './acp.mjs';
import { fakeModel } from './model.mjs';
import { checkDevicePrompt } from './device.mjs';
import { checkClaudePrompt, checkClaudeCredentials } from './claude-login.mjs';

const exec = promisify(execFile);
const agent = process.argv[2];
assert.ok(['codex', 'claude-code'].includes(agent));
assert.equal(process.env.HOME, '/home/bot');
const manifest = JSON.parse(
	await readFile(new URL('./package.json', import.meta.url), 'utf8'),
).terminay;
const declaration = manifest.contributes.botAgents.find((a) =>
	a.id.endsWith(`/${agent}`),
);
for (const pin of declaration.imageInstall.npm) {
	const at = pin.lastIndexOf('@');
	const pkg = JSON.parse(
		await readFile(
			`/usr/local/lib/node_modules/${pin.slice(0, at)}/package.json`,
			'utf8',
		),
	);
	assert.equal(
		pkg.version,
		pin.slice(at + 1),
		'image must contain exact adapter pin',
	);
}
const fake = await fakeModel();
const key = 'terminay-fake-key-never-a-provider-credential';
const env = {
	PATH: process.env.PATH,
	HOME: '/home/bot',
	LANG: 'C.UTF-8',
	...declaration.launchEnvironment,
	// The host lists credential variable names (never values) for the image's
	// tool-shell wrapper.
	TERMINAY_CREDENTIAL_VARIABLES: (declaration.credentialSecrets ?? [])
		.map((secret) => secret.environmentVariable)
		.join(' '),
};
if (agent === 'codex') env.CODEX_API_KEY = key;
else
	Object.assign(env, {
		ANTHROPIC_API_KEY: key,
		ANTHROPIC_BASE_URL: fake.url,
		CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
	});
if (declaration.deviceSignIn) {
	for (const file of declaration.deviceSignIn.configFiles ?? []) {
		const target = join('/home/bot', file.path);
		await mkdir(join(target, '..'), { recursive: true });
		await writeFile(target, file.contents);
	}
	const loginEnv = { PATH: env.PATH, HOME: env.HOME, LANG: env.LANG };
	if (agent === 'codex')
		await checkDevicePrompt(declaration.deviceSignIn, loginEnv);
	else await checkClaudePrompt(declaration.deviceSignIn, loginEnv);
	await exec(
		declaration.deviceSignIn.signOutCommand.executable,
		declaration.deviceSignIn.signOutCommand.args,
		{ env: loginEnv, timeout: 30000 },
	);
	console.log(`${agent}: device sign-in URL and code passed`);
}
for (const file of declaration.botConfigFiles ?? []) {
	await mkdir(join('/home/bot', file.path, '..'), { recursive: true });
	await writeFile(join('/home/bot', file.path), file.contents);
}
if (agent === 'codex') {
	// Provider must be configured before initialize/authenticate, not CODEX_CONFIG.
	const config = declaration.botConfigFiles[0];
	await writeFile(
		join('/home/bot', config.path),
		// A custom provider over HTTP: the built-in OpenAI provider tries a
		// WebSocket first, and catalogued model ids get a different tool setup.
		`model = "fake/conformance"\nmodel_provider = "fake"\n${config.contents}\n[model_providers.fake]\nname = "Fake"\nbase_url = "${fake.url}/v1"\nwire_api = "responses"\nenv_key = "CODEX_API_KEY"\n`,
	);
}
let client;
const open = async () => {
	const instance = new Acp(declaration.acpCommand.executable, env);
	instance.on('unsupported', (method) =>
		assert.fail(`client capability requested: ${method}`),
	);
	const init = await instance.call('initialize', {
		protocolVersion: 1,
		clientCapabilities: {},
		clientInfo: { name: 'terminay-conformance', version: '1' },
	});
	assert.equal(init.protocolVersion, 1);
	for (const secret of declaration.credentialSecrets ?? []) {
		if (secret.authenticateMethodId && env[secret.environmentVariable])
			await instance.call('authenticate', {
				methodId: secret.authenticateMethodId,
			});
	}
	return { instance, init };
};
const prompt = (sid) =>
	client.call('session/prompt', {
		sessionId: sid,
		prompt: [{ type: 'text', text: 'Perform the conformance check.' }],
	});
try {
	let opened = await open();
	client = opened.instance;
	const created = await client.call('session/new', {
		cwd: '/home/bot',
		mcpServers: [],
	});
	const sid = created.sessionId;
	assert.equal(typeof sid, 'string');
	const model = created.configOptions.find(
		(option) => option.category === 'model',
	);
	assert.ok(model?.options.length > 0);
	const selected = model.options[0].value;
	await client.call('session/set_config_option', {
		sessionId: sid,
		configId: model.id,
		value: selected,
	});
	if (declaration.autonomousOnly)
		await client.call('session/set_config_option', {
			sessionId: sid,
			configId: 'mode',
			value: 'agent-full-access',
		});
	assert.equal((await prompt(sid)).stopReason, 'end_turn');
	assert.ok(
		client.updates.some(
			(u) =>
				u.sessionUpdate === 'agent_message_chunk' &&
				u.content?.text?.includes('offline-pong'),
		),
	);
	assert.ok(fake.state.requests.length > 0);
	assert.ok(fake.state.requests.every((r) => typeof r.model === 'string'));
	fake.next('tool');
	assert.equal((await prompt(sid)).stopReason, 'end_turn');
	assert.ok(client.updates.some((u) => u.sessionUpdate === 'tool_call'));
	if (!declaration.autonomousOnly)
		assert.ok(client.permissions.length > 0, 'Claude must ask permission');
	const proof = JSON.parse(await readFile('/home/bot/tool-proof.json', 'utf8'));
	assert.equal(proof.user, 'bot');
	assert.deepEqual(
		proof.credentials,
		[],
		'shell must not inherit credential variables',
	);
	async function scan(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const target = join(directory, entry.name);
			if (entry.isDirectory()) await scan(target);
			else if (entry.isFile())
				assert.equal(
					(await readFile(target)).includes(Buffer.from(key)),
					false,
					`credential persisted: ${target}`,
				);
		}
	}
	await scan('/home/bot');
	const offset = client.updates.length;
	fake.next('cancel');
	const running = prompt(sid);
	await client.waitFor((updates) =>
		updates
			.slice(offset)
			.some(
				(u) =>
					['tool_call', 'tool_call_update'].includes(u.sessionUpdate) &&
					u.status === 'in_progress',
			),
	);
	client.notify('session/cancel', { sessionId: sid });
	assert.equal((await running).stopReason, 'cancelled');
	await client.close();
	assert.equal(opened.init.agentCapabilities.loadSession, true);
	opened = await open();
	client = opened.instance;
	await client.call('session/load', {
		sessionId: sid,
		cwd: '/home/bot',
		mcpServers: [],
	});
	fake.next('text');
	assert.equal((await prompt(sid)).stopReason, 'end_turn');
	if (agent === 'claude-code') {
		await client.close();
		client = null;
		await checkClaudeCredentials(declaration, env);
		console.log(
			'claude-code: saved login, API key and setup token selection passed',
		);
	}
	console.log(
		`${agent}: initialize, new, stream, tool, permission, model, cancel, restart/load, credential confinement passed`,
	);
} finally {
	await client?.close();
	await fake.close();
}
