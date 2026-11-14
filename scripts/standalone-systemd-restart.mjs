#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { prepareSystemdSourceArchive, verifyPreparedSystemdSourceArchive } from './systemd-source-archive.mjs';

/**
 * Restart a real standalone server under a real systemd and prove, from shell
 * output alone, that every terminal kept across the restart and every new one
 * can still use /tmp (ADR-0116).
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
	const result = spawnSync(command, args, { stdio: 'inherit', timeout: 120000, ...options });
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

/** Build from a tiny context so scenario inputs never invalidate the apt layer. */
export function buildSystemdImage({ image = DEFAULT_IMAGE, runCommand = run } = {}) {
	const dockerfile = readFileSync(new URL('../Dockerfile.systemd-test', import.meta.url), 'utf8');
	const key = createHash('sha256').update(dockerfile).update('\0').update(image).digest('hex').slice(0, 20);
	const runtimeImage = `terminay-systemd-test:${key}`;
	const context = mkdtempSync(join(tmpdir(), 'terminay-systemd-image-'));
	try {
		// A fresh context has just the Dockerfile. Docker reuses the installed apt
		// layer across commits; the registry mirror remains an explicit input.
		cpSync(new URL('../Dockerfile.systemd-test', import.meta.url), join(context, 'Dockerfile'));
		runCommand('docker', ['build', '--build-arg', `SYSTEMD_BASE_IMAGE=${image}`, '--tag', runtimeImage, context], { timeout: 300000 });
		return runtimeImage;
	} finally {
		rmSync(context, { recursive: true, force: true });
	}
}

export function runSystemdRestart({ archive, scenarios = SCENARIOS, image = DEFAULT_IMAGE, negative = false, preparedImage, containerName, preparedArchive, preparedProvenance }) {
	if (preparedImage && !/^terminay-systemd-test:[a-f0-9]{20}$/u.test(preparedImage)) throw new Error('Invalid prepared systemd image');
	if (containerName && !/^terminay-systemd-restart-[a-f0-9-]+$/u.test(containerName)) throw new Error('Invalid systemd container name');
	const repositoryRoot = resolve(new URL('..', import.meta.url).pathname);
	const container = containerName ?? `terminay-systemd-restart-${randomUUID().slice(0, 8)}`;
	if (Boolean(preparedArchive) !== Boolean(preparedProvenance)) throw new Error('Prepared archive needs provenance');
	const provenance = preparedArchive ? verifyPreparedSystemdSourceArchive(resolve(archive), resolve(preparedArchive), resolve(preparedProvenance)) : undefined;
	const archivePath = resolve(preparedArchive ?? archive);
	const stage = mkdtempSync(join(tmpdir(), 'terminay-systemd-restart-'));
	try {
		const runtimeImage = preparedImage ?? buildSystemdImage({ image });
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
			runtimeImage,
			'/lib/systemd/systemd',
		]);
		for (const part of ['cli', 'driver', 'archive']) run('docker', ['cp', join(stage, part), `${container}:/${part}`]);
		let booted = false;
		const bootDeadline = Date.now() + 240000;
		while (!booted && Date.now() < bootDeadline) {
			const probe = spawnSync('docker', ['exec', container, 'systemctl', 'is-system-running'], {
				encoding: 'utf8',
				timeout: 5000,
			});
			booted = /running|degraded/u.test(probe.stdout ?? '');
			if (!booted) spawnSync('sleep', ['2']);
		}
		if (!booted) {
			spawnSync('docker', ['logs', container], { stdio: 'inherit', timeout: 10000 });
			throw new Error('systemd did not come up in the container');
		}
		run('timeout', [
			'1200',
			'docker',
			'exec',
			...(negative ? ['-e', 'TERMINAY_SYSTEMD_NEGATIVE=1'] : []),
			...(provenance ? ['-e', `TERMINAY_SYSTEMD_PREPARED_SHA256=${provenance.preparedSha256}`, '-e', `TERMINAY_SYSTEMD_PREPARED_ROOT=${provenance.rootName}`, '-e', `TERMINAY_SYSTEMD_PREPARED_REVISION=${provenance.revision}`, '-e', `TERMINAY_SYSTEMD_PREPARED_TARGET=${provenance.target}`] : []),
			container,
			'node',
			'/driver/driver.mjs',
			`/archive/${basename(archivePath)}`,
			scenarios.join(','),
		], { timeout: 1205000 });
	} finally {
		rmSync(stage, { recursive: true, force: true });
		if (process.env.TERMINAY_SYSTEMD_KEEP !== '1')
			spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore', timeout: 30000 });
		else process.stderr.write(`kept container ${container}\n`);
	}
}

/** Independent scenarios share the immutable runtime image, never a container. */
export async function runSystemdScenarios({ archive, scenarios = SCENARIOS, negative = false, buildImage = buildSystemdImage, prepareArchive = prepareSystemdSourceArchive, spawnChild = spawn, stopChild = (child) => {
	try { if (process.platform === 'win32') child.kill('SIGKILL'); else process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
}, removeContainer = (container) => spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore', timeout: 30000 }) }) {
	if (!scenarios.length || scenarios.some(scenario => !SCENARIOS.includes(scenario)) || new Set(scenarios).size !== scenarios.length) throw new Error('Scenarios must be a nonempty unique subset of A,B,C');
	const image = buildImage();
	let prepared;
	let interrupted;
	const children = new Set();
	const containers = [];
	const completions = [];
	let rejectAbort;
	const abort = new Promise((_resolve, reject) => { rejectAbort = reject; });
	abort.catch(() => {}); // Signals may arrive while bounded archive preparation finishes.
	const onSignal = signal => { interrupted = new Error(`Systemd scenarios interrupted by ${signal}`); rejectAbort(interrupted); };
	const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
	const handlers = signals.map(signal => { const handler = () => onSignal(signal); process.on(signal, handler); return handler; });
	const deadline = setTimeout(() => rejectAbort(new Error('Systemd scenarios exceeded 1500 seconds')), 1500000);
	try {
		prepared = await prepareArchive(archive);
		if (interrupted) throw interrupted;
		for (const scenario of scenarios) {
			const container = `terminay-systemd-restart-${randomUUID()}`;
			containers.push(container);
			const child = spawnChild(process.execPath, [new URL(import.meta.url).pathname, '--archive', resolve(archive), '--scenarios', scenario, '--prepared-image', image, '--prepared-archive', prepared.archivePath, '--prepared-provenance', prepared.provenancePath, '--container-name', container], { detached: process.platform !== 'win32', stdio: 'inherit', env: { ...process.env, ...(negative ? { TERMINAY_SYSTEMD_NEGATIVE: '1' } : {}) } });
			children.add(child);
			completions.push(new Promise((resolveChild, reject) => {
				child.once('error', error => { children.delete(child); reject(error); });
				child.once('close', (code, signal) => { children.delete(child); if (code === 0) resolveChild(); else reject(new Error(`Systemd scenario ${scenario} exited with ${code ?? signal}`)); });
			}));
		}
		await Promise.race([Promise.all(completions), abort]);
	} finally {
		clearTimeout(deadline);
		signals.forEach((signal, index) => { process.removeListener(signal, handlers[index]); });
		for (const child of children) stopChild(child);
		// Removing a container also ends an exec that outlived a killed Docker client.
		if (process.env.TERMINAY_SYSTEMD_KEEP !== '1') for (const container of containers) removeContainer(container);
		await Promise.allSettled(completions);
		await prepared?.close();
	}
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
	const archive = argument('--archive');
	if (archive === undefined) {
		process.stderr.write('Usage: standalone-systemd-restart.mjs --archive <archive> [--scenarios A,B,C]\n');
		process.exit(64);
	}
	const options = { archive, scenarios: argument('--scenarios', SCENARIOS.join(',')).split(','), negative: process.env.TERMINAY_SYSTEMD_NEGATIVE === '1' };
	const preparedImage = argument('--prepared-image');
	try {
		if (preparedImage) runSystemdRestart({ ...options, preparedImage, containerName: argument('--container-name'), preparedArchive: argument('--prepared-archive'), preparedProvenance: argument('--prepared-provenance') });
		else await runSystemdScenarios(options);
		process.stdout.write('Standalone systemd restart passed.\n');
	} catch (error) {
		process.stderr.write(`${error.message}\n`);
		process.exitCode = 1;
	}
}
