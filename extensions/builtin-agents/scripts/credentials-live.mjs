// Runs only in a disposable bot container, through bot-credentials.mjs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { Acp } from './acp.mjs';

const key = process.env.OPENROUTER_API_KEY;
assert.ok(key);
assert.equal(process.env.HOME, '/home/bot');
const run = (args, home, input) =>
	new Promise((resolve, reject) => {
		const child = spawn('codex', args, {
			env: { PATH: process.env.PATH, HOME: home },
			stdio: ['pipe', 'ignore', 'ignore'],
		});
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			reject(new Error('CLI deadline'));
		}, 30_000);
		child.once('error', () => {
			clearTimeout(timer);
			reject(new Error('CLI failed'));
		});
		child.once('exit', (code) => {
			clearTimeout(timer);
			code === 0 ? resolve() : reject(new Error('CLI failed'));
		});
		child.stdin.end(input);
	});
const host = '/run/test-host';
const shared = `${host}/.codex/auth.json`;
await run(['login', '--with-api-key'], host, `${key}\n`);
for (const home of ['/tmp/test-bot-one', '/tmp/test-bot-two']) {
	await mkdir(`${home}/.codex`, { recursive: true });
	await symlink(shared, `${home}/.codex/auth.json`);
}
await Promise.all(
	[host, '/tmp/test-bot-one', '/tmp/test-bot-two'].map((home) =>
		run(['login', '--with-api-key'], home, `${key}\n`),
	),
);
assert.equal(JSON.parse(await readFile(shared, 'utf8')).OPENAI_API_KEY, key);
await run(['logout'], host);
await assert.rejects(readFile('/tmp/test-bot-one/.codex/auth.json'));
await run(['login', '--with-api-key'], host, `${key}\n`);
assert.equal(
	JSON.parse(await readFile('/tmp/test-bot-two/.codex/auth.json', 'utf8'))
		.OPENAI_API_KEY,
	key,
);

// Only the two cheap models approved by the feasibility gate.
await mkdir('/home/bot/.codex', { recursive: true });
await writeFile(
	'/home/bot/.codex/config.toml',
	// A custom provider: the built-in OpenAI provider tries a WebSocket first.
	'model = "openai/gpt-6-luna"\nmodel_provider = "openrouter"\ncli_auth_credentials_store = "ephemeral"\n[shell_environment_policy]\nexclude = ["CODEX_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"]\n[model_providers.openrouter]\nname = "OpenRouter"\nbase_url = "https://openrouter.ai/api/v1"\nwire_api = "responses"\nenv_key = "CODEX_API_KEY"\n',
);
for (const agent of ['codex', 'claude']) {
	const env = { PATH: process.env.PATH, HOME: '/home/bot' };
	if (agent === 'codex') env.CODEX_API_KEY = key;
	else
		Object.assign(env, {
			ANTHROPIC_AUTH_TOKEN: key,
			ANTHROPIC_API_KEY: '',
			ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
			ANTHROPIC_MODEL: 'anthropic/claude-haiku-5.5',
			ANTHROPIC_DEFAULT_HAIKU_MODEL: 'anthropic/claude-haiku-5.5',
			ANTHROPIC_DEFAULT_SONNET_MODEL: 'anthropic/claude-haiku-5.5',
			ANTHROPIC_DEFAULT_OPUS_MODEL: 'anthropic/claude-haiku-5.5',
			ANTHROPIC_SMALL_FAST_MODEL: 'anthropic/claude-haiku-5.5',
			CLAUDE_CODE_MAX_RETRIES: '0',
			CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
		});
	const client = new Acp(
		agent === 'codex' ? 'codex-acp' : 'claude-agent-acp',
		env,
	);
	try {
		await client.call('initialize', {
			protocolVersion: 1,
			clientCapabilities: {},
		});
		if (agent === 'codex')
			await client.call('authenticate', { methodId: 'api-key' });
		const session = await client.call('session/new', {
			cwd: '/home/bot',
			mcpServers: [],
		});
		if (agent === 'codex')
			await client.call('session/set_config_option', {
				sessionId: session.sessionId,
				configId: 'mode',
				value: 'agent-full-access',
			});
		const result = await client.call('session/prompt', {
			sessionId: session.sessionId,
			prompt: [
				{ type: 'text', text: 'Reply with just the word credential-check-ok.' },
			],
		});
		assert.equal(result.stopReason, 'end_turn');
		// The reply streams in chunks; a word can be split across them.
		const reply = client.updates
			.filter((u) => u.sessionUpdate === 'agent_message_chunk')
			.map((u) => u.content?.text ?? '')
			.join('');
		assert.ok(reply.includes('credential-check-ok'), `${agent} reply`);
	} finally {
		await client.close();
	}
}
async function scan(directory) {
	const { readdir } = await import('node:fs/promises');
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const target = `${directory}/${entry.name}`;
		if (entry.isDirectory()) await scan(target);
		else if (entry.isFile())
			assert.equal(
				(await readFile(target)).includes(Buffer.from(key)),
				false,
				'API key reached bot disk',
			);
	}
}
await scan('/home/bot');
await rm(shared, { force: true });
