import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const enabled = process.env.TERMINAY_BOT_CONFORMANCE === '1';
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
			await run(['image', 'inspect', 'terminay-bot:local']);
		} catch {
			return t.skip('build the pinned bot image first');
		}
		const name = `terminay-bot-conformance-${randomUUID()}`;
		t.after(() => run(['rm', '-fv', name]).catch(() => {}));
		await run([
			'run',
			'-d',
			'--pull=never',
			'--name',
			name,
			'--network',
			'none',
			'--entrypoint',
			'sleep',
			'terminay-bot:local',
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
		assert.match(stdout, /credential confinement passed/);
		if (agent === 'codex')
			assert.match(stdout, /device sign-in URL and code passed/);
	});
}
