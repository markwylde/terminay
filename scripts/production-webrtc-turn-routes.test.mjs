import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const COTURN_IMAGE = 'docker.io/coturn/coturn:4.6.3-r3'
const TURN_PORT = 34781
const RELAY_MIN = 49160
const RELAY_MAX = 49169

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`${command} timed out.`))
    }, options.timeoutMs ?? 360_000)
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      resolve({
        code,
        signal,
        stderr: Buffer.concat(stderr).toString(),
        stdout: Buffer.concat(stdout).toString(),
      })
    })
  })
}

function redact(output, secret) {
  return output.split(secret).join('[redacted]')
}

test('secure production Werift proves direct and authenticated TURN routes', {
  timeout: 420_000,
}, async () => {
  const proofRoot = await mkdtemp(path.join(os.tmpdir(), 'terminay-turn-routes-'))
  const configRoot = path.join(proofRoot, 'coturn')
  const configPath = path.join(configRoot, 'turnserver.conf')
  const secret = randomBytes(32).toString('base64url')
  const container = `terminay-turn-route-${process.pid}-${Date.now()}`
  let started = false
  try {
    await mkdir(configRoot, { recursive: true })
    await writeFile(configPath, [
      'fingerprint',
      'use-auth-secret',
      `static-auth-secret=${secret}`,
      'realm=terminay-route-proof.invalid',
      'pidfile=/tmp/turnserver.pid',
      'listening-port=3478',
      `min-port=${RELAY_MIN}`,
      `max-port=${RELAY_MAX}`,
      'external-ip=127.0.0.1',
      'allow-loopback-peers',
      'no-cli',
      'no-multicast-peers',
      'no-tls',
      'no-dtls',
      'user-quota=8',
      'total-quota=16',
      '',
    ].join('\n'))
    await chmod(configPath, 0o600)
    assert.equal((await stat(configPath)).mode & 0o777, 0o600)

    const launch = await run('docker', [
      'run',
      '--detach',
      '--name',
      container,
      '--publish',
      `127.0.0.1:${TURN_PORT}:3478/udp`,
      '--publish',
      `127.0.0.1:${RELAY_MIN}-${RELAY_MAX}:${RELAY_MIN}-${RELAY_MAX}/udp`,
      '--read-only',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=1m',
      '--user',
      `${process.getuid()}:${process.getgid()}`,
      '--security-opt',
      'no-new-privileges',
      '--volume',
      `${configPath}:/etc/coturn/turnserver.conf:ro`,
      COTURN_IMAGE,
      '-c',
      '/etc/coturn/turnserver.conf',
    ], { timeoutMs: 180_000 })
    assert.equal(launch.code, 0, redact(launch.stderr || launch.stdout, secret))
    started = true
    await new Promise((resolve) => setTimeout(resolve, 1_000))

    const proofEnv = {
      ...process.env,
      TERMINAY_TURN_CONFIG_PATH: configPath,
      TERMINAY_TURN_PORT: String(TURN_PORT),
      TERMINAY_TURN_ROUTE_ONLY: '1',
    }
    delete proofEnv.NODE_TEST_CONTEXT
    const proof = await run(process.execPath, [
      '--test',
      'scripts/production-headless-webrtc-secure-werift.test.mjs',
    ], {
      cwd: process.cwd(),
      env: proofEnv,
    })
    const rawOutput = `${proof.stdout}\n${proof.stderr}`
    assert.equal(rawOutput.includes(secret), false, 'The TURN REST secret leaked into proof output.')
    const safeOutput = redact(rawOutput, secret)
    assert.equal(proof.signal, null)
    assert.equal(proof.code, 0, safeOutput)
    assert.match(safeOutput, /"routeTests":2/)
  } finally {
    if (started) await run('docker', ['rm', '--force', container], { timeoutMs: 30_000 })
    await rm(proofRoot, { force: true, recursive: true })
  }
})
