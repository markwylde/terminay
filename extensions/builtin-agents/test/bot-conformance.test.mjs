import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const enabled = process.env.TERMINAY_BOT_CONFORMANCE === '1';
const image = process.env.TERMINAY_BOT_CONFORMANCE_IMAGE ?? 'terminay-bot:local';
for (const agent of ['codex', 'claude-code']) {
	test(`3.3 ${agent}: pinned adapter in offline bot image`, {
		skip: !enabled,
		timeout: 240_000,
	}, async (t) => {
		const engine = process.env.TERMINAY_BOT_ENGINE ?? 'docker';
		assert.ok(['docker', 'podman'].includes(engine));
		const env = Object.fromEntries(
			[
				'PATH',
				'HOME',
				'TMPDIR',
				'XDG_RUNTIME_DIR',
				'DOCKER_HOST',
				'DOCKER_CONTEXT',
				'CONTAINER_HOST',
				'CONTAINER_CONNECTION',
			]
				.filter((k) => process.env[k] !== undefined)
				.map((k) => [k, process.env[k]]),
		);
		const run = (args, timeout = 30_000) =>
			exec(engine, args, { env, timeout, maxBuffer: 1024 * 1024 });
		try {
			await run(['info']);
		} catch {
			return t.skip('container engine unavailable');
		}
		try {
			await run(['image', 'inspect', image]);
		} catch {
			return t.skip('build the pinned bot image first');
		}
		const name = `terminay-bot-conformance-${randomUUID()}`;
		const homeVolume = `${name}-home`;
		t.after(async () => {
			await run(['rm', '-fv', name]).catch(() => {});
			if (agent === 'claude-code')
				await run(['volume', 'rm', homeVolume]).catch(() => {});
		});
		await run([
			'run',
			'-d',
			'--pull=never',
			'--name',
			name,
			'--network',
			'none',
			...(agent === 'claude-code'
				? ['--mount', `type=volume,source=${homeVolume},target=/home/bot`]
				: []),
			'--entrypoint',
			'sleep',
			image,
			'infinity',
		]);
		await run([
			'cp',
			fileURLToPath(new URL('./bots', import.meta.url)),
			`${name}:/tmp/bots`,
		]);
		await run([
			'cp',
			fileURLToPath(new URL('../package.json', import.meta.url)),
			`${name}:/tmp/bots/package.json`,
		]);
		// Copies arrive owned by root with the checkout's modes.
		await run(['exec', '-u', 'root', name, 'chown', '-R', 'bot', '/tmp/bots']);
		const { stdout } = await run(
			[
				'exec',
				'-u',
				'bot',
				'-e',
				'HOME=/home/bot',
				name,
				'node',
				'/tmp/bots/run.mjs',
				agent,
			],
			200_000,
		);
		if (agent === 'claude-code') {
			await run(['stop', name]);
			await run(['start', name]);
			const checkHome = `const fs=require('node:fs');const assert=require('node:assert/strict');const p='/home/bot/.claude/.credentials.json';assert.equal(fs.statSync(p).mode&511,384);assert.equal(JSON.parse(fs.readFileSync(p)).claudeAiOauth.accessToken,'synthetic-saved-login');`;
			await run(['exec', '-u', 'bot', name, 'node', '-e', checkHome]);
			await run(['stop', name]);
			// A fresh container mounts the retained home, then the CLI removes its login.
			await run([
				'run',
				'--rm',
				'--pull=never',
				'--network',
				'none',
				'--mount',
				`type=volume,source=${homeVolume},target=/home/bot`,
				'--user',
				'bot',
				'--env',
				'HOME=/home/bot',
				'--entrypoint',
				'node',
				image,
				'-e',
				`${checkHome}require('node:child_process').execFileSync('claude',['auth','logout'],{stdio:'pipe'});assert.equal(fs.existsSync(p),false);`,
			]);
		}
		assert.match(stdout, /credential confinement passed/);
		assert.match(stdout, /device sign-in URL and code passed/);
		if (agent === 'claude-code')
			assert.match(
				stdout,
				/saved login, API key and setup token selection passed/,
			);
	});
}
