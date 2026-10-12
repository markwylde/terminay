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
	'workspace UI',
	'status',
	'advertise-address',
	'upgrade',
	'upgrade helper',
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

// A session holder outlives the server that started it. This suite is not
// about held terminals, so the servers it starts keep theirs in-process and
// nothing is left running when it finishes.
process.env.TERMINAY_SESSION_HOLDER ??= '0';

export async function buildArchive({ directory, version, revision, channel = 'source' }) {
  const rootName = 'terminay-server-' + version + '-linux-' + process.arch
  const root = join(directory, rootName)
  await mkdir(join(root, 'bin'), { recursive: true })
  await mkdir(join(root, 'ui'), { recursive: true })
  // Named for the entry the hosted archive loader reads, so the fixture stands
  // in for a real archive rather than one that would serve a placeholder.
  await writeFile(join(root, 'ui', 'server.html'), '<!doctype html>\\n')

  // A launcher that answers /readyz on the health port and then blocks, so
  // systemd supervises a process that behaves like the real server.
  const launcher = [
    '#!/bin/sh',
    'set -eu',
    ': "\${TERMINAY_SERVER_VERSION:=' + version + '}"',
    'export TERMINAY_SERVER_VERSION',
    'exec node -e \\'' +
      'const http=require("http");' +
      'const port=Number(process.env.TERMINAY_HEALTH_PORT||8444);' +
      // A process left running outside the server, as the session holder that
      // owns terminals is. It is started once and must outlive every restart.
      'const fs=require("fs");const held="/run/terminay-smoke-holder.pid";' +
      'if(!fs.existsSync(held)){const c=require("child_process").spawn("sleep",["100000"],{detached:true,stdio:"ignore"});c.unref();fs.writeFileSync(held,String(c.pid))}' +
      'http.createServer((q,s)=>{s.writeHead(200,{"content-type":"application/json"});' +
      's.end(JSON.stringify({status:"ok",ready:true,phase:"ready",serverId:process.env.TERMINAY_SERVER_ID,version:process.env.TERMINAY_SERVER_VERSION}))})' +
      '.listen(port,"127.0.0.1");' +
      'process.on("SIGTERM",()=>process.exit(0));' +
      'setInterval(()=>{},1e9);' +
      '\\'',
  ].join('\\n') + '\\n'
  await writeFile(join(root, 'bin', 'terminay-server'), launcher)
  await chmod(join(root, 'bin', 'terminay-server'), 0o755)

  // Where a real archive carries the bundled CLI. The stand-in runs the same
  // upgrade the CLI runs, pointed at the smoke's own signed release.
  await writeFile(join(root, 'bin', 'terminay'), '#!/bin/sh\\nexec node /smoke/upgrader.mjs "$@"\\n')
  await chmod(join(root, 'bin', 'terminay'), 0o755)

  const files = []
  for (const path of ['bin/terminay', 'bin/terminay-server', 'ui/server.html']) {
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
        channel,
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

/**
 * What the helper's oneshot executes as `<prefix>/current/bin/terminay`.
 *
 * The shipped CLI trusts one release key and one release host, by design, so
 * a smoke cannot hand it a release of its own. This stand-in records how
 * systemd invoked it and then runs the CLI's own upgrade with exactly the
 * arguments it was given, against the signed release the driver serves.
 */
export const HELPER_UPGRADER = `
import { appendFileSync, existsSync, readFileSync } from 'node:fs'

appendFileSync('/var/log/terminay-smoke-upgrader.log', JSON.stringify({
  argv: process.argv.slice(2),
  uid: process.getuid(),
  helper: process.env.TERMINAY_UPGRADE_HELPER ?? null,
}) + '\\n')

const seam = '/run/terminay-smoke-release.json'
if (!existsSync(seam)) process.exit(0)
const { origin, publicKeyPem } = JSON.parse(readFileSync(seam, 'utf8'))
// The release is served by the driver over a certificate made for this run.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const { parseCommandLine } = await import('/cli/dist/args.js')
const { runUpgrade } = await import('/cli/dist/commands/upgrade.js')
const { resolveContext } = await import('/cli/dist/context.js')

const write = (line) => process.stdout.write(line + '\\n')
const parsed = parseCommandLine(process.argv.slice(2))
await runUpgrade(parsed.ref, parsed.options, await resolveContext({ options: parsed.options, write }), {
  apiBase: origin,
  webBase: origin,
  releasePublicKeyPem: publicKeyPem,
  readinessTimeoutMs: 30000,
})
`;

/** The driver that runs inside the container, against the real systemd. */
export const CONTAINER_DRIVER = `
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { buildArchive } from '/smoke/build-archive.mjs'
import { parseCommandLine } from '/cli/dist/args.js'
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

write('--- workspace UI ---')
// A device that pairs and then receives a placeholder is the defect this
// asserts against: the environment must name the directory the server reads,
// and the archive must carry the entry it will look for there.
const environment = readFileSync('/etc/terminay/server.env', 'utf8')
const renderer = /^TERMINAY_UI_RENDERER_DIRECTORY=(.*)$/m.exec(environment)?.[1]
assert.ok(renderer, 'the install must name the renderer directory the server reads')
assert.ok(existsSync(join(renderer, 'server.html')), 'the archive must ship the hosted UI entry at ' + renderer)

write('--- status ---')
const status = await runStatus(await resolveContext({ options, write }))
assert.equal(status.version, '9.9.0')
assert.equal(status.ready, true, 'the supervised process must report ready')
assert.equal(status.enabled, true)

write('--- advertise-address ---')
// Reinstalling with the flag is what an operator does to add one, and it must
// reach the environment file the unit reads and the record status reports.
// It must also reach the running process: enable --now does nothing to a
// unit that is already up, which would leave the operator reading a new
// address in the command's output while the old one is still being offered.
const pidBefore = systemctl('show', 'terminay-server.service', '-p', 'MainPID', '--value')
await runInstall(undefined, { ...options, advertiseAddress: '192.168.1.20:51000' }, {
  write,
  streams,
  localArchivePath: first,
  readinessTimeoutMs: 30000,
})
const advertisedEnvironment = readFileSync('/etc/terminay/server.env', 'utf8')
assert.match(advertisedEnvironment, /TERMINAY_WEBRTC_ADVERTISE_ADDRESS=192.168.1.20:51000/)
assert.equal((await readInstallRecord(layout)).advertiseAddress, '192.168.1.20:51000')
assert.equal(systemctl('is-active', 'terminay-server.service'), 'active')
const pidAfter = systemctl('show', 'terminay-server.service', '-p', 'MainPID', '--value')
assert.notEqual(pidAfter, pidBefore, 'a running service must be restarted onto the new configuration')
const advertisedStatus = await runStatus(await resolveContext({ options, write }))
assert.equal(advertisedStatus.advertiseAddress, '192.168.1.20:51000')

// A loopback address is refused rather than written. A browser need not send
// connectivity checks to one, and Firefox does not, so it would produce a
// server that pairs from Chromium and hangs elsewhere.
let refused
try {
  parseCommandLine(['daemon', 'install', '--advertise-address', '127.0.0.1:51000'])
} catch (error) {
  refused = error
}
assert.ok(refused, 'a loopback advertised address must be refused')
assert.match(refused.message, /loopback/)
assert.match(refused.message, /routable address/)
assert.match(readFileSync('/etc/terminay/server.env', 'utf8'), /TERMINAY_WEBRTC_ADVERTISE_ADDRESS=192.168.1.20:51000/)

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

write('--- upgrade helper ---')
// A system-scope service cannot restart its own unit, so the install left a
// root-owned path unit and oneshot. systemd, not the CLI, is asked whether
// they are there, and the upgrade below is started by systemd alone.
const helper = layout.upgradeHelper
assert.equal(systemctl('is-enabled', 'terminay-upgrade.path'), 'enabled')
assert.equal(systemctl('is-active', 'terminay-upgrade.path'), 'active')
assert.match(systemctl('cat', 'terminay-upgrade.service'), /ExecStart=\\/opt\\/terminay\\/current\\/bin\\/terminay daemon upgrade --system\\n/)
for (const unit of [helper.pathUnitPath, helper.serviceUnitPath]) {
  const info = statSync(unit)
  assert.equal(info.uid, 0, unit + ' must be owned by root')
  assert.equal(info.mode & 0o022, 0, unit + ' must not be writable by anyone else')
}
assert.equal(statSync(helper.requestDirectory).mode & 0o777, 0o700)

// A tagged install has a channel to follow, and the smoke serves that channel
// itself: one release, checksummed and signed with a key made for this run.
const record = JSON.parse(readFileSync(layout.recordPath, 'utf8'))
writeFileSync(layout.recordPath, JSON.stringify({ ...record, channel: 'tag' }, null, 2) + '\\n')
const third = await buildArchive({ directory: workspace, version: '9.9.2', revision: 'c'.repeat(40), channel: 'tag' })
const assetName = 'terminay-server-9.9.2-linux-' + process.arch + '.tar.gz'
const archiveBytes = readFileSync(third)
const keys = generateKeyPairSync('ed25519')
const assets = new Map([
  [assetName, archiveBytes],
  [assetName + '.sha256', Buffer.from(createHash('sha256').update(archiveBytes).digest('hex') + '  ' + assetName + '\\n')],
  [assetName + '.sig', sign(null, archiveBytes, keys.privateKey)],
])
execFileSync('openssl', [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
  '-keyout', join(workspace, 'tls.key'), '-out', join(workspace, 'tls.crt'),
], { stdio: 'ignore' })
const releaseServer = createServer(
  { key: readFileSync(join(workspace, 'tls.key')), cert: readFileSync(join(workspace, 'tls.crt')) },
  (request, response) => {
    const url = request.url ?? ''
    if (url.startsWith('/repos/markwylde/terminay/releases/')) {
      const body = JSON.stringify({ tag_name: 'v9.9.2', published_at: '2026-10-01T00:00:00Z', assets: [{ name: assetName }] })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(body)
      return
    }
    const asset = assets.get(basename(url))
    if (url.startsWith('/markwylde/terminay/releases/download/v9.9.2/') && asset !== undefined) {
      response.writeHead(200, { 'content-length': asset.length })
      response.end(asset)
      return
    }
    response.writeHead(404)
    response.end()
  },
)
await new Promise((resolve) => releaseServer.listen(0, '127.0.0.1', resolve))
writeFileSync('/run/terminay-smoke-release.json', JSON.stringify({
  origin: 'https://127.0.0.1:' + releaseServer.address().port,
  publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
}))

const holder = Number(readFileSync('/run/terminay-smoke-holder.pid', 'utf8'))
const helperPidBefore = systemctl('show', 'terminay-server.service', '-p', 'MainPID', '--value')
// This is the whole of what the unprivileged server does. What it writes is
// never read: a reference, a flag, and a path here change nothing.
writeFileSync(helper.requestFile, 'v0.0.1 --allow-downgrade /etc/passwd\\n')

let upgraded = false
for (let attempt = 0; attempt < 120 && !upgraded; attempt += 1) {
  upgraded =
    (await readInstallRecord(layout)).version === '9.9.2' &&
    systemctl('is-active', 'terminay-upgrade.service') !== 'activating'
  if (!upgraded) await new Promise((resolve) => setTimeout(resolve, 1000))
}
releaseServer.close()
if (!upgraded) write(execFileSync('journalctl', ['-u', 'terminay-upgrade.service', '--no-pager', '-n', '40'], { encoding: 'utf8' }))
assert.equal(upgraded, true, 'the request must cause systemd to run the upgrade')
assert.equal(systemctl('show', 'terminay-upgrade.service', '-p', 'Result', '--value'), 'success')

// systemd ran the fixed command as root, with nothing taken from the request.
const invocations = readFileSync('/var/log/terminay-smoke-upgrader.log', 'utf8').trim().split('\\n').map((line) => JSON.parse(line))
assert.deepEqual(invocations, [{ argv: ['daemon', 'upgrade', '--system'], uid: 0, helper: '1' }])

// The server is back, ready, on the new release, as a new process.
assert.equal(systemctl('is-active', 'terminay-server.service'), 'active')
const helperStatus = await runStatus(await resolveContext({ options, write }))
assert.equal(helperStatus.version, '9.9.2')
assert.equal(helperStatus.ready, true)
assert.equal(await activeVersion(layout), '9.9.2')
assert.notEqual(systemctl('show', 'terminay-server.service', '-p', 'MainPID', '--value'), helperPidBefore)
const helperHealth = await (await fetch('http://127.0.0.1:8444/readyz')).json()
assert.equal(helperHealth.version, '9.9.2')
// What was running outside the server before the upgrade still is.
assert.doesNotThrow(() => process.kill(holder, 0), 'a process held outside the server must survive the upgrade')
// The helper's own watch was never stopped, so the next request works too.
assert.equal(systemctl('is-active', 'terminay-upgrade.path'), 'active')
const outcome = JSON.parse(readFileSync(layout.resultPath, 'utf8'))
assert.equal(outcome.outcome, 'succeeded')
assert.equal(outcome.from, '9.9.1')
assert.equal(outcome.to, '9.9.2')
assert.equal(statSync(layout.resultPath).mode & 0o444, 0o444)

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
for (const unit of ['terminay-upgrade.path', 'terminay-upgrade.service']) {
  let known = true
  try {
    execFileSync('systemctl', ['cat', unit], { stdio: 'pipe' })
  } catch {
    known = false
  }
  assert.equal(known, false, 'systemd must no longer know ' + unit)
}
assert.equal(existsSync(helper.requestDirectory), false)

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
		await writeFile(join(workspace, 'upgrader.mjs'), HELPER_UPGRADER);

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
			'apt-get update -qq && apt-get install -y -qq systemd nodejs openssl >/dev/null 2>&1 && exec /lib/systemd/systemd',
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
