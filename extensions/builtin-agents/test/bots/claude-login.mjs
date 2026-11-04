import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, stat, writeFile } from 'node:fs/promises';
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

/** Synthetic credentials prove selection against the actual native CLI without an account. */
export async function checkClaudeCredentials(_declaration, baseEnv) {
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
			const child = spawn(
				'claude',
				[
					'-p',
					'Check selected authentication.',
					'--output-format',
					'stream-json',
					'--verbose',
					'--no-session-persistence',
					'--model',
					'fake/conformance',
					'--setting-sources',
					'',
					'--tools',
					'',
					'--permission-prompts',
					'none',
					...(mode.startsWith('key') ? ['--bare'] : []),
				],
				{ cwd: '/home/bot', env, stdio: ['ignore', 'pipe', 'pipe'] },
			);
			let output = '';
			child.stdout.on('data', (c) => (output += c));
			child.stderr.resume();
			const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
			const [code] = await once(child, 'exit');
			clearTimeout(timer);
			assert.equal(code === 0, mode !== 'key-rejected', output);
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
		}
		await access('/home/bot/.claude/.credentials.json');
	} finally {
		await fake.close();
	}
}
