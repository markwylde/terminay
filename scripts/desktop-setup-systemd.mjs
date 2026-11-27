#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildSystemdImage, DEFAULT_IMAGE, stageCli } from './standalone-systemd-restart.mjs';

/**
 * Run the server desktop's setup helper under a real systemd, with the real
 * package manager, in a throwaway Debian container:
 *
 *   node scripts/desktop-setup-systemd.mjs [--image <debian image>]
 *
 * It proves, from what systemd and the status file say, that changing the
 * trigger starts the one fixed command whatever is written into it, that the
 * run-as account can read progress and cannot write it, that a run killed
 * mid-install is recovered from by the next, that the packages enable and
 * start no unit, that a burst of triggers is rate-limited, and that removing
 * the helper leaves nothing. See `desktop-setup-systemd/driver.mjs`.
 *
 * It needs a Docker daemon that can run a privileged container with systemd
 * as PID 1 and reach a Debian mirror, and a built CLI
 * (`npm run build --workspace terminay`).
 */

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { stdio: 'inherit', timeout: 120000, ...options });
	if (result.status !== 0)
		throw new Error(`${command} ${args.join(' ')} exited with ${result.status ?? result.signal}`);
	return result;
}

const imageIndex = process.argv.indexOf('--image');
const image = imageIndex === -1 ? DEFAULT_IMAGE : process.argv[imageIndex + 1];
const repositoryRoot = resolve(new URL('..', import.meta.url).pathname);
const container = `terminay-desktop-setup-${randomUUID().slice(0, 8)}`;
const stage = mkdtempSync(join(tmpdir(), 'terminay-desktop-setup-'));
try {
	const runtimeImage = buildSystemdImage({ image });
	stageCli(repositoryRoot, join(stage, 'cli'));
	cpSync(resolve(repositoryRoot, 'scripts/desktop-setup-systemd'), join(stage, 'driver'), { recursive: true });
	run('docker', ['run', '--detach', '--name', container, '--privileged', '--tmpfs', '/run', '--tmpfs', '/run/lock', runtimeImage, '/lib/systemd/systemd']);
	for (const part of ['cli', 'driver']) run('docker', ['cp', join(stage, part), `${container}:/${part}`]);
	let booted = false;
	const bootDeadline = Date.now() + 240000;
	while (!booted && Date.now() < bootDeadline) {
		const probe = spawnSync('docker', ['exec', container, 'systemctl', 'is-system-running'], { encoding: 'utf8', timeout: 5000 });
		booted = /running|degraded/u.test(probe.stdout ?? '');
		if (!booted) spawnSync('sleep', ['2']);
	}
	if (!booted) throw new Error('systemd did not come up in the container');
	run('timeout', ['1500', 'docker', 'exec', container, 'node', '/driver/driver.mjs'], { timeout: 1505000 });
} finally {
	rmSync(stage, { recursive: true, force: true });
	if (process.env.TERMINAY_SYSTEMD_KEEP !== '1') spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore', timeout: 30000 });
	else process.stderr.write(`kept container ${container}\n`);
}
