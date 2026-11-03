#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { planBotImage } from '../packages/server-core/dist/botService/image.js';

// Exercise the same Dockerfile generator, scripts, IDs and pinned contribution
// used by the application. Do not overlay scripts onto an arbitrary old image.
const root = path.resolve(import.meta.dirname, '..');
const context = await mkdtemp(path.join(tmpdir(), 'terminay-bot-mcp-ci-'));
const suffix = randomBytes(6).toString('hex');
const image = `terminay-bot-mcp-test:${suffix}`;
const harness = `terminay-bot-mcp-harness:${suffix}`;
const docker = (...args) =>
	execFileSync('docker', args, { stdio: 'inherit', cwd: root });
try {
	docker('info');
	const pkg = JSON.parse(
		await readFile(
			path.join(root, 'extensions/builtin-agents/package.json'),
			'utf8',
		),
	);
	const agent = pkg.terminay.contributes.botAgents.find(
		(agent) => agent.acpCommand.executable === 'claude-agent-acp',
	);
	if (!agent) throw new Error('pinned Claude bot contribution is required');
	const source = path.join(
		root,
		'packages/server-core/dist/botService/image-context',
	);
	const plan = await planBotImage(
		source,
		[
			{
				id: agent.id,
				install: {
					npm: agent.imageInstall.npm,
					apt: agent.imageInstall.debian ?? [],
				},
			},
		],
		1000,
		1000,
	);
	const sourcePlan = await planBotImage(
		path.join(root, 'docker/terminay-bot'),
		[
			{
				id: agent.id,
				install: {
					npm: agent.imageInstall.npm,
					apt: agent.imageInstall.debian ?? [],
				},
			},
		],
		1000,
		1000,
	);
	if (sourcePlan.fingerprint !== plan.fingerprint)
		throw new Error('the shipped bot image context is stale');
	const botContext = path.join(context, 'bot');
	await cp(source, botContext, { recursive: true });
	await writeFile(path.join(botContext, 'Dockerfile'), plan.dockerfile);
	docker(
		'build',
		'--build-arg',
		'BOT_UID=1000',
		'--build-arg',
		'BOT_GID=1000',
		'-t',
		image,
		botContext,
	);
	const runnerContext = path.join(context, 'runner');
	await build({
		entryPoints: [
			path.join(root, 'packages/server-core/test/bot-runtime-real.test.mjs'),
		],
		bundle: true,
		platform: 'node',
		format: 'esm',
		outfile: path.join(runnerContext, 'test.mjs'),
	});
	await writeFile(
		path.join(runnerContext, 'Dockerfile'),
		`FROM ${image}\nCOPY test.mjs /test.mjs\nENTRYPOINT ["node", "--test", "/test.mjs"]\n`,
	);
	docker('build', '-t', harness, runnerContext);
	// The source is daemon-side, which also works when the CI job reaches its
	// Docker daemon over TCP. The code under test only receives a local socket.
	const socket =
		process.env.TERMINAY_BOT_MCP_DAEMON_SOCKET ?? '/var/run/docker.sock';
	if (!path.isAbsolute(socket))
		throw new Error('an absolute daemon-side socket is required');
	docker(
		'run',
		'--rm',
		'--security-opt',
		'label=disable',
		'--network',
		'none',
		'--mount',
		`type=bind,source=${socket},target=/var/run/docker.sock`,
		'--env',
		'DOCKER_HOST=unix:///var/run/docker.sock',
		'--env',
		'TERMINAY_BOT_MCP_REQUIRED=1',
		'--env',
		`TERMINAY_BOT_MCP_SMOKE_IMAGE=${image}`,
		harness,
	);
} finally {
	try {
		docker('image', 'rm', '--no-prune', harness, image);
	} catch {
		/* Keep the test's failure. */
	}
	await rm(context, { recursive: true, force: true });
}
