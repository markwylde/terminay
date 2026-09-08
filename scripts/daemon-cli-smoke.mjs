#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Exercise `terminay daemon` against a real systemd, in a container.
 *
 * The rest of the CLI suite runs against a stub `systemctl`, which is what
 * makes it runnable on a laptop. A stub cannot tell you whether the unit file
 * the installer writes is one systemd will actually accept, whether
 * `enable --now` brings the service up, or whether `uninstall` leaves systemd
 * with no dangling unit. That is what this smoke covers, and only that.
 *
 * It installs a locally built archive rather than a release, which the CLI
 * treats exactly as it treats a source build: no publisher, so no signature,
 * and the manifest verified as always. Download and signature verification are
 * covered by the unit suite against a real HTTPS fixture and real signatures.
 *
 * Opt-in (`TERMINAY_RUN_DAEMON_SMOKE=1`): it needs a privileged container
 * running systemd as PID 1, and a few minutes.
 */

export const DEFAULT_IMAGE = 'debian:12-slim';
export const SMOKE_ENVIRONMENT_FLAG = 'TERMINAY_RUN_DAEMON_SMOKE';

export function isSmokeEnabled(env = process.env) {
	return env[SMOKE_ENVIRONMENT_FLAG] === '1';
}

/** The lifecycle the smoke drives, in order. */
export const SMOKE_STEPS = Object.freeze([
	'install',
	'status',
	'upgrade',
	'qr-code --no-wait',
	'uninstall',
]);

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { stdio: 'inherit', ...options });
	if (result.status !== 0) {
		throw new Error(
			`${command} ${args.join(' ')} exited with ${result.status ?? 'a signal'}`,
		);
	}
	return result;
}

/**
 * Builds a miniature archive with the shape the real builder produces. The
 * launcher is a shell script that serves a readiness endpoint and then waits,
 * so systemd has something real to supervise.
 */
export const ARCHIVE_BUILDER = `
import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export async function buildArchive({ directory, version, revision }) {
  const rootName = 'terminay-server-' + version + '-linux-' + process.arch
  const root = join(directory, rootName)
  await mkdir(join(root, 'bin'), { recursive: true })
  await mkdir(join(root, 'ui'), { recursive: true })
  await writeFile(join(root, 'ui', 'index.html'), '<!doctype html>\\n')

  // A launcher that answers /readyz on the health port and then blocks, so
  // systemd supervises a process that behaves like the real server.
  const launcher = [
    '#!/bin/sh',
    'set -eu',
    ': "\${TERMINAY_SERVER_VERSION:=' + version + '}"',
    'exec node -e \\'' +
      'const http=require("http");' +
      'const port=Number(process.env.TERMINAY_HEALTH_PORT||8444);' +
      'http.createServer((q,s)=>{s.writeHead(200,{"content-type":"application/json"});' +
      's.end(JSON.stringify({status:"ok",ready:true,phase:"ready",serverId:process.env.TERMINAY_SERVER_ID,version:process.env.TERMINAY_SERVER_VERSION}))})' +
      '.listen(port,"127.0.0.1");' +
      'process.on("SIGTERM",()=>process.exit(0));' +
      'setInterval(()=>{},1e9);' +
      '\\'',
  ].join('\\n') + '\\n'
  await writeFile(join(root, 'bin', 'terminay-server'), launcher)
  await chmod(join(root, 'bin', 'terminay-server'), 0o755)

  const files = []
  for (const path of ['bin/terminay-server', 'ui/index.html']) {
    const absolute = join(root, path)
    const info = await stat(absolute)
    files.push({
      path,
      mode: (info.mode & 0o777).toString(8).padStart(3, '0'),
      size: info.size,
      sha256: createHash('sha256').update(await readFile(absolute)).digest('hex'),
    })
  }
  files.sort((left, right) => left.path.localeCompare(right.path))

  await writeFile(
    join(root, 'artifact-manifest.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        artifact: 'terminay-server',
        target: 'linux-' + process.arch,
        channel: 'source',
        revision,
        architecture: process.arch,
        version,
        entrypoints: { server: 'bin/terminay-server' },
        files,
      },
      null,
      2,
    ) + '\\n',
  )

  const archivePath = join(directory, rootName + '.tar.gz')
  execFileSync('tar', ['-czf', archivePath, '-C', directory, rootName])
  return archivePath
}
`;

/** The driver that runs inside the container, against the real systemd. */
export const CONTAINER_DRIVER = `
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildArchive } from '/smoke/build-archive.mjs'
import { runInstall } from '/cli/dist/commands/install.js'
import { runStart, runStatus, runStop } from '/cli/dist/commands/lifecycle.js'
import { runPairing } from '/cli/dist/commands/pairing.js'
import { runUninstall } from '/cli/dist/commands/uninstall.js'
import { runUpgrade } from '/cli/dist/commands/upgrade.js'
import { resolveContext } from '/cli/dist/context.js'
import { activeVersion } from '/cli/dist/install.js'
import { installLayout, readInstallRecord } from '/cli/dist/layout.js'

const write = (line) => process.stdout.write(line + '\\n')
const options = {
  allowDowngrade: false,
  purge: false,
  yes: true,
  wait: false,
  scope: 'system',
  expose: 'hosted',
  runAs: 'root',
}
const streams = { input: { isTTY: false }, output: process.stdout }
// \`is-active\` answers by exit status as well as stdout, so the helper reads
// the output rather than treating a non-zero exit as a failure.
const systemctl = (...args) => {
  try {
    return execFileSync('systemctl', args, { encoding: 'utf8' }).trim()
  } catch (error) {
    if (typeof error.stdout === 'string' && error.stdout.trim().length > 0) return error.stdout.trim()
    throw error
  }
}
const layout = installLayout('system')

const workspace = await mkdtemp(join(tmpdir(), 'smoke-archives-'))
const first = await buildArchive({ directory: workspace, version: '9.9.0', revision: 'a'.repeat(40) })
const second = await buildArchive({ directory: workspace, version: '9.9.1', revision: 'b'.repeat(40) })

write('--- install ---')
await runInstall(undefined, options, { write, streams, localArchivePath: first, readinessTimeoutMs: 30000 })

// systemd itself, not a stub, has accepted and started the unit.
assert.match(systemctl('cat', 'terminay-server.service'), /ExecStart=.*current\\/bin\\/terminay-server/)
assert.equal(systemctl('is-enabled', 'terminay-server.service'), 'enabled')
assert.equal(systemctl('is-active', 'terminay-server.service'), 'active')
assert.equal((await readInstallRecord(layout)).version, '9.9.0')
assert.equal(await activeVersion(layout), 'source-' + 'a'.repeat(12))

write('--- status ---')
const status = await runStatus(await resolveContext({ options, write }))
assert.equal(status.version, '9.9.0')
assert.equal(status.ready, true, 'the supervised process must report ready')
assert.equal(status.enabled, true)

write('--- advertise-address ---')
// Reinstalling with the flag is what an operator does to add one, and it must
// reach the environment file the unit reads and the record status reports.
await runInstall(undefined, { ...options, advertiseAddress: '127.0.0.1:51000' }, {
  write,
  streams,
  localArchivePath: first,
  readinessTimeoutMs: 30000,
})
const advertisedEnvironment = readFileSync('/etc/terminay/server.env', 'utf8')
assert.match(advertisedEnvironment, /TERMINAY_WEBRTC_ADVERTISE_ADDRESS=127.0.0.1:51000/)
assert.equal((await readInstallRecord(layout)).advertiseAddress, '127.0.0.1:51000')
assert.equal(systemctl('is-active', 'terminay-server.service'), 'active')
const advertisedStatus = await runStatus(await resolveContext({ options, write }))
assert.equal(advertisedStatus.advertiseAddress, '127.0.0.1:51000')

write('--- stop and start ---')
const lifecycle = await resolveContext({ options, write })
await runStop(lifecycle)
assert.notEqual(systemctl('is-active', 'terminay-server.service'), 'active')
assert.equal(await runStart(lifecycle), true)

write('--- upgrade ---')
await runUpgrade(undefined, options, await resolveContext({ options, write }), {})
  .then(() => assert.fail('a source install must refuse to guess what to upgrade to'))
  .catch((error) => assert.match(error.message, /no channel to follow/))
// An explicit local archive is the supported way to move a source install on.
await runInstall(undefined, options, { write, streams, localArchivePath: second, readinessTimeoutMs: 30000 })
assert.equal((await readInstallRecord(layout)).version, '9.9.1')
assert.equal(systemctl('is-active', 'terminay-server.service'), 'active')

write('--- qr-code --no-wait ---')
// These archives have no server behind them, so there is no approval socket.
// What is proven is that the command fails clearly rather than hanging or
// printing a URL that nothing would route.
let reported = ''
try {
  await runPairing({ ...options, wait: false }, await resolveContext({ options, write }))
} catch (error) {
  reported = error.message
}
assert.match(reported, /not exposed|accepts commands|did not answer/)

write('--- uninstall ---')
await runUninstall(options, await resolveContext({ options, write }), streams)
let stillKnown = true
try {
  execFileSync('systemctl', ['cat', 'terminay-server.service'], { stdio: 'pipe' })
} catch {
  stillKnown = false
}
assert.equal(stillKnown, false, 'systemd must no longer know the unit')

write('SMOKE OK')
`;

export async function runDaemonSmoke(options = {}) {
	const image = options.image ?? DEFAULT_IMAGE;
	const container = `terminay-daemon-smoke-${randomUUID().slice(0, 8)}`;
	const workspace = await mkdtemp(join(tmpdir(), 'terminay-daemon-smoke-'));
	const repositoryRoot = resolve(new URL('..', import.meta.url).pathname);
	try {
		await writeFile(join(workspace, 'build-archive.mjs'), ARCHIVE_BUILDER);
		await writeFile(join(workspace, 'driver.mjs'), CONTAINER_DRIVER);

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
			'-v',
			`${join(repositoryRoot, 'apps/terminay-cli')}:/cli:ro`,
			// The CLI's one runtime dependency is hoisted to the workspace root, so
			// it is mounted where Node will look for it.
			'-v',
			`${join(repositoryRoot, 'node_modules')}:/cli/node_modules:ro`,
			'-v',
			`${workspace}:/smoke:ro`,
			image,
			'/bin/sh',
			'-c',
			'apt-get update -qq && apt-get install -y -qq systemd nodejs >/dev/null 2>&1 && exec /lib/systemd/systemd',
		]);

		// systemd takes a moment to reach a state where systemctl answers.
		let booted = false;
		for (let attempt = 0; attempt < 90 && !booted; attempt += 1) {
			const probe = spawnSync(
				'docker',
				['exec', container, 'systemctl', 'is-system-running'],
				{ encoding: 'utf8' },
			);
			booted = /running|degraded/u.test(probe.stdout ?? '');
			if (!booted) spawnSync('sleep', ['2']);
		}
		if (!booted) {
			spawnSync('docker', ['logs', container], { stdio: 'inherit' });
			throw new Error('systemd did not come up inside the smoke container');
		}

		run('docker', ['exec', container, 'node', '/smoke/driver.mjs']);
	} finally {
		spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
		await rm(workspace, { recursive: true, force: true });
	}
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)
) {
	if (!isSmokeEnabled()) {
		console.log(
			`Set ${SMOKE_ENVIRONMENT_FLAG}=1 to run the systemd container smoke.`,
		);
		process.exit(0);
	}
	await runDaemonSmoke();
	console.log('Daemon CLI smoke passed.');
}
