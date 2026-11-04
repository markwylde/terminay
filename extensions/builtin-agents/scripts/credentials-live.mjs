// Runs only in a disposable bot container, through bot-credentials.mjs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const key = process.env.OPENROUTER_API_KEY;
assert.ok(key);
assert.equal(process.env.HOME, '/home/bot');
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
	await new Promise((resolve, reject) => {
		const command = agent === 'codex' ? 'codex' : 'claude';
		const args =
			agent === 'codex'
				? [
						'exec',
						'--json',
						'--skip-git-repo-check',
						'--dangerously-bypass-approvals-and-sandbox',
						'Reply with just the word credential-check-ok.',
					]
				: [
						'-p',
						'Reply with just the word credential-check-ok.',
						'--output-format',
						'stream-json',
						'--verbose',
						'--no-session-persistence',
						'--tools',
						'',
					];
		const child = spawn(command, args, {
			env,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let output = '';
		child.stdout.on('data', (c) => (output += c));
		child.stderr.resume();
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			reject(new Error('Native CLI deadline'));
		}, 30000);
		child.once('error', reject);
		child.once('close', (code) => {
			clearTimeout(timer);
			if (code === 0 && output.includes('credential-check-ok')) resolve();
			else reject(new Error('Native credential check failed'));
		});
	});
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
