#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

/**
 * Restart a real standalone server under a real systemd and prove, from shell
 * output alone, that every terminal kept across the restart and every new one
 * can still use /tmp (ADR-0115).
 *
 *   node scripts/standalone-systemd-restart.mjs --archive <terminay-server-*.tar.gz> [--scenarios A,B,C]
 *
 * A: two restarts; the kept terminal and a new one can both mkdir /tmp.
 * B: a unit with PrivateTmp, as an older upgrader leaves it, with that
 *    upgrader's oneshot still running: the server waits for it, asks for the
 *    repair, the unit is repaired, the damaged holder is drained and its
 *    session marked, a new terminal works, and the drained holder exits once
 *    its last session closes. TERMINAY_SYSTEMD_NEGATIVE=1 stops the helper's
 *    watch first, and the scenario must then fail.
 * C: an upgrade that cannot reach the release host repairs the unit,
 *    restarts once, and still reports the failure.
 *
 * It needs a Docker (or Podman) daemon that can run a privileged container
 * with systemd as PID 1, an archive built for that daemon's architecture, and
 * a built CLI (`npm run build --workspace terminay` in apps/terminay-cli).
 */

// Docker Hub rate-limits the Gitea runners, which take its images from the
// internal mirror instead, which holds Debian 12 as `bookworm-slim` only.
export const DEFAULT_IMAGE = process.env.TERMINAY_DOCKER_HUB_MIRROR
	? `${process.env.TERMINAY_DOCKER_HUB_MIRROR}/debian:bookworm-slim`
	: 'docker.io/library/debian:bookworm-slim';
export const SCENARIOS = Object.freeze(['A', 'B', 'C']);

function argument(name, fallback) {
	const index = process.argv.indexOf(name);
	return index === -1 ? fallback : process.argv[index + 1];
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { stdio: 'inherit', ...options });
	if (result.status !== 0)
		throw new Error(`${command} ${args.join(' ')} exited with ${result.status ?? result.signal}`);
	return result;
}

/**
 * The CLI's built code and the packages it needs at run time, laid out as
 * /cli with its own node_modules. Copied in rather than bind-mounted: on the
 * CI runners the Docker daemon is the host's, and paths inside the job
 * container mean nothing to it.
 */
function stageCli(repositoryRoot, into) {
	const cliRoot = resolve(repositoryRoot, 'apps/terminay-cli');
	if (!existsSync(join(cliRoot, 'dist/commands/install.js')))
		throw new Error('build the CLI first: npm run build --workspace terminay');
	cpSync(join(cliRoot, 'dist'), join(into, 'dist'), { recursive: true });
	cpSync(join(cliRoot, 'package.json'), join(into, 'package.json'));
	const seen = new Set();
	const visit = (name) => {
		if (seen.has(name)) return;
		seen.add(name);
		const found = [join(cliRoot, 'node_modules', name), join(repositoryRoot, 'node_modules', name)].find((path) =>
			existsSync(join(path, 'package.json')),
		);
		if (found === undefined) throw new Error(`the CLI needs ${name}, which is not installed`);
		// Its own nested node_modules come with it.
		cpSync(found, join(into, 'node_modules', name), { recursive: true, dereference: true });
		const manifest = JSON.parse(readFileSync(join(found, 'package.json'), 'utf8'));
		for (const dependency of Object.keys(manifest.dependencies ?? {})) visit(dependency);
	};
	const manifest = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8'));
	for (const dependency of Object.keys(manifest.dependencies ?? {})) visit(dependency);
}

export function runSystemdRestart({ archive, scenarios = SCENARIOS, image = DEFAULT_IMAGE, negative = false }) {
	const repositoryRoot = resolve(new URL('..', import.meta.url).pathname);
	const container = `terminay-systemd-restart-${randomUUID().slice(0, 8)}`;
	const archivePath = resolve(archive);
	const stage = mkdtempSync(join(tmpdir(), 'terminay-systemd-restart-'));
	try {
		stageCli(repositoryRoot, join(stage, 'cli'));
		cpSync(resolve(repositoryRoot, 'scripts/standalone-systemd-restart'), join(stage, 'driver'), { recursive: true });
		mkdirSync(join(stage, 'archive'));
		cpSync(archivePath, join(stage, 'archive', basename(archivePath)));
		run('docker', [
			'run',
			'--detach',
			'--name',
			container,
			'--privileged',
			'--tmpfs',
			'/run',
			'--tmpfs',
			'/run/lock',
			image,
			'/bin/sh',
			'-c',
			'apt-get update -qq && apt-get install -y -qq systemd systemd-sysv nodejs procps util-linux sudo >/dev/null 2>&1 && exec /lib/systemd/systemd',
		]);
		for (const part of ['cli', 'driver', 'archive']) run('docker', ['cp', join(stage, part), `${container}:/${part}`]);
		let booted = false;
		for (let attempt = 0; attempt < 120 && !booted; attempt += 1) {
			const probe = spawnSync('docker', ['exec', container, 'systemctl', 'is-system-running'], {
				encoding: 'utf8',
			});
			booted = /running|degraded/u.test(probe.stdout ?? '');
			if (!booted) spawnSync('sleep', ['2']);
		}
		if (!booted) {
			spawnSync('docker', ['logs', container], { stdio: 'inherit' });
			throw new Error('systemd did not come up in the container');
		}
		run('timeout', [
			'1200',
			'docker',
			'exec',
			...(negative ? ['-e', 'TERMINAY_SYSTEMD_NEGATIVE=1'] : []),
			container,
			'node',
			'/driver/driver.mjs',
			`/archive/${basename(archivePath)}`,
			scenarios.join(','),
		]);
	} finally {
		rmSync(stage, { recursive: true, force: true });
		if (process.env.TERMINAY_SYSTEMD_KEEP !== '1')
			spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
		else process.stderr.write(`kept container ${container}\n`);
	}
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
	const archive = argument('--archive');
	if (archive === undefined) {
		process.stderr.write('Usage: standalone-systemd-restart.mjs --archive <archive> [--scenarios A,B,C]\n');
		process.exit(64);
	}
	runSystemdRestart({
		archive,
		scenarios: argument('--scenarios', SCENARIOS.join(',')).split(','),
		negative: process.env.TERMINAY_SYSTEMD_NEGATIVE === '1',
	});
	process.stdout.write('Standalone systemd restart passed.\n');
}
