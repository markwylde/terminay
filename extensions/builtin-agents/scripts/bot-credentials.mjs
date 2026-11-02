#!/usr/bin/env node
// Opt-in owner check. All writes are confined to a newly created throwaway home.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	realpath,
	rm,
	writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const inside = (parent, child) =>
	child === parent || child.startsWith(`${parent}${path.sep}`);

export async function validateThrowawayHome(home, env = process.env) {
	const canonical = await realpath(home);
	const temporary = await realpath(tmpdir());
	const realHome = await realpath(homedir());
	if (
		inside(realHome, canonical) ||
		!inside(temporary, canonical) ||
		canonical === temporary ||
		!path.basename(canonical).startsWith('terminay-bot-credentials-') ||
		(await lstat(home)).isSymbolicLink() ||
		canonical !== path.resolve(home)
	) {
		throw new Error(
			'Refusing real agent homes: use a canonical throwaway directory in the system temporary directory',
		);
	}
	for (const name of ['HOME', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR']) {
		if (env[name] === undefined || name === 'HOME') continue;
		const candidate = await realpath(env[name]);
		if (!inside(canonical, candidate))
			throw new Error(
				`Refusing real agent homes: ${name} must be inside the throwaway home`,
			);
	}
	if ((await readdir(canonical)).length !== 0)
		throw new Error(
			'Refusing nonempty agent home: the throwaway home must be empty',
		);
	return canonical;
}

async function main() {
	const args = process.argv.slice(2);
	if (args.length && (args.length !== 2 || args[0] !== '--home'))
		throw new Error(
			'Usage: npm run test:bots:credentials -- [--home /private/tmp/terminay-bot-credentials-...]',
		);
	// Validate explicit homes even without opt-in, before accessing any credential.
	let home = args[1];
	if (home) home = await validateThrowawayHome(home);
	if (process.env.TERMINAY_BOT_CREDENTIALS !== '1')
		throw new Error(
			'Opt in with TERMINAY_BOT_CREDENTIALS=1; dedicated test accounts only',
		);
	if (!process.env.OPENROUTER_API_KEY)
		throw new Error(
			'OPENROUTER_API_KEY is required for the cheap-model owner check',
		);
	if (!home)
		home = await mkdtemp(
			path.join(await realpath(tmpdir()), 'terminay-bot-credentials-'),
		);
	await validateThrowawayHome(home);
	const engine = process.env.TERMINAY_BOT_ENGINE ?? 'docker';
	if (!['docker', 'podman'].includes(engine))
		throw new Error('Expected docker or podman');
	const name = `terminay-bot-credentials-${randomUUID()}`;
	const exec = promisify(execFile);
	const engineEnv = Object.fromEntries(
		[
			'PATH',
			'HOME',
			'TMPDIR',
			'XDG_RUNTIME_DIR',
			'DOCKER_HOST',
			'DOCKER_CONTEXT',
			'CONTAINER_HOST',
			'CONTAINER_CONNECTION',
			'OPENROUTER_API_KEY',
		]
			.filter((k) => process.env[k] !== undefined)
			.map((k) => [k, process.env[k]]),
	);
	const run = (args, timeout = 30_000) =>
		exec(engine, args, { env: engineEnv, timeout, maxBuffer: 1024 * 1024 });
	try {
		await mkdir(path.join(home, '.codex'));
		await mkdir(path.join(home, '.claude'));
		// Metadata only. The model key is delivered by variable name to exec below.
		await writeFile(
			path.join(home, 'OWNER-TEST'),
			'Dedicated credential check; safe to delete.\n',
		);
		await run([
			'run',
			'-d',
			'--pull=never',
			'--name',
			name,
			'--mount',
			`type=bind,src=${home},dst=/run/test-host`,
			'--entrypoint',
			'sleep',
			'terminay-bot:local',
			'infinity',
		]);
		await run([
			'cp',
			fileURLToPath(new URL('../test/bots', import.meta.url)),
			`${name}:/tmp/bots`,
		]);
		await run([
			'cp',
			fileURLToPath(new URL('./credentials-live.mjs', import.meta.url)),
			`${name}:/tmp/bots/credentials-live.mjs`,
		]);
		// Values never enter argv or container configuration. Do not print captured
		// engine output/errors: an adapter may include a credential in diagnostics.
		await run([
			'exec',
			'-u',
			'root',
			name,
			'chown',
			'-R',
			'bot',
			'/run/test-host',
			// Copies arrive owned by root with the checkout's modes.
			'/tmp/bots',
		]);
		await run(
			[
				'exec',
				'-u',
				'bot',
				'-e',
				'HOME=/home/bot',
				'-e',
				'OPENROUTER_API_KEY',
				name,
				'node',
				'/tmp/bots/credentials-live.mjs',
			],
			240_000,
		);
		console.log(
			'Dedicated API-key sign-in, sharing, logout/login, and cheap-model turns passed. OAuth refresh remains an owner check.',
		);
	} catch {
		throw new Error(
			'Credential check failed; adapter output suppressed to protect credentials',
		);
	} finally {
		await run(['rm', '-fv', name]).catch(() => {});
		await rm(home, { recursive: true, force: true });
	}
}
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	main().catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
}
