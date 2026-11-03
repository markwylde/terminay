import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile, stat, access } from 'node:fs/promises';
import { Acp } from './acp.mjs';
import { fakeModel } from './model.mjs';

/** Native CLI prompt, offline, with no browser or real credentials. */
export async function checkClaudePrompt(device, env) {
	const child = spawn(device.command.executable, device.command.args, {
		env: { ...env, BROWSER: 'false' },
		stdio: ['pipe', 'pipe', 'pipe'],
	});
	const exited = once(child, 'exit');
	try {
		await new Promise((resolve, reject) => {
			let output = '';
			const timer = setTimeout(
				() => reject(new Error('Claude login prompt deadline')),
				15000,
			);
			const data = (bytes) => {
				output += bytes.toString();
				if (
					/https:\/\/[^\s]+\/oauth\/authorize\?/.test(output) &&
					/Paste code here/i.test(output)
				) {
					clearTimeout(timer);
					resolve();
				}
			};
			child.stdout.on('data', data);
			child.stderr.on('data', data);
			exited.then(() => {
				clearTimeout(timer);
				reject(new Error('Claude exited before code prompt'));
			}, reject);
		});
	} finally {
		child.kill('SIGKILL');
		await exited;
	}
}

/** Synthetic credentials prove selection against the actual adapter without an account. */
export async function checkClaudeCredentials(declaration, baseEnv) {
	const fake = await fakeModel();
	try {
		const login = 'synthetic-saved-login';
		const token = 'synthetic-setup-token';
		const key = 'synthetic-api-key';
		await mkdir('/home/bot/.claude', { recursive: true });
		await writeFile(
			'/home/bot/.claude/.credentials.json',
			JSON.stringify({
				claudeAiOauth: {
					accessToken: login,
					refreshToken: 'synthetic-refresh-token',
					expiresAt: Date.now() + 3600000,
					scopes: ['user:inference', 'user:profile'],
					subscriptionType: 'max',
				},
			}),
			{ mode: 0o600 },
		);
		assert.equal(
			(await stat('/home/bot/.claude/.credentials.json')).mode & 0o777,
			0o600,
		);
		for (const mode of [
			'login',
			'key',
			'token',
			'login',
			'key-rejected',
			'login',
		]) {
			const env = {
				...baseEnv,
				ANTHROPIC_BASE_URL: fake.url,
				CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL: '1',
			};
			delete env.ANTHROPIC_API_KEY;
			delete env.CLAUDE_CODE_OAUTH_TOKEN;
			if (mode.startsWith('key')) env.ANTHROPIC_API_KEY = key;
			fake.state.rejectAuth = mode === 'key-rejected';
			if (mode === 'token') env.CLAUDE_CODE_OAUTH_TOKEN = token;
			const start = fake.state.requests.length;
			const client = new Acp(declaration.acpCommand.executable, env);
			try {
				await client.call('initialize', {
					protocolVersion: 1,
					clientCapabilities: {},
					clientInfo: { name: 'login-check', version: '1' },
				});
				const session = await client.call('session/new', {
					cwd: '/home/bot',
					mcpServers: [],
				});
				const prompting = client.call('session/prompt', {
					sessionId: session.sessionId,
					prompt: [{ type: 'text', text: 'Check selected authentication.' }],
				});
				if (mode === 'key-rejected') await assert.rejects(prompting);
				else await prompting;
				const requests = fake.state.requests
					.slice(start)
					.filter((r) => r.path.split('?')[0].endsWith('/messages'));
				assert.ok(requests.length > 0);
				for (const request of requests) {
					if (mode.startsWith('key')) {
						assert.equal(request.apiKey, key);
						assert.equal(request.authorization, undefined);
					} else {
						assert.equal(
							request.authorization,
							`Bearer ${mode === 'token' ? token : login}`,
						);
						assert.equal(request.apiKey, undefined);
					}
				}
			} finally {
				await client.close();
			}
		}
		await access('/home/bot/.claude/.credentials.json');
	} finally {
		await fake.close();
	}
}
