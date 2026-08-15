import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const directory = await mkdtemp(join(tmpdir(), 'terminay-signaling-bootstrap-'))
const output = join(directory, 'bootstrap.mjs')
await build({
  bundle: true,
  entryPoints: ['electron/remote/desktopSignalingBootstrap.ts'],
  format: 'esm',
  logLevel: 'silent',
  outfile: output,
  platform: 'node',
  target: 'node20',
})
const { parseDesktopSignalingBootstrap } = await import(pathToFileURL(output).href)
test.after(async () => rm(directory, { force: true, recursive: true }))

const NOW = 1_000_000
const valid = () => ({
  schemaVersion: 1,
  protocolVersion: 'v1',
  role: 'offerer',
  serverId: 'server-a',
  deviceId: 'device-a',
  peerId: 'peer-a',
  sessionOrigin: 'https://session.example',
  signalingUrl: 'wss://session.example/signal',
  expiresAt: NOW + 60_000,
  iceServers: [
    { urls: 'stun:stun.example:3478' },
    {
      urls: ['turns:turn.example:5349?transport=tcp'],
      username: 'short-lived-user',
      credential: 'short_lived_turn_credential',
      expiresAt: NOW + 30_000,
    },
  ],
})

test('accepts the exact versioned origin-bound Desktop signaling bootstrap', () => {
  const parsed = parseDesktopSignalingBootstrap(valid(), 'https://session.example', NOW)
  assert.equal(parsed.schemaVersion, 1)
  assert.equal(parsed.role, 'offerer')
  assert.equal(parsed.iceServers.length, 2)
  assert.equal(parsed.iceServers[1].expiresAt, NOW + 30_000)
})

test('rejects incompatible, cross-origin, credentialed-route, stale, and widened bootstraps', () => {
  for (const candidate of [
    { ...valid(), schemaVersion: 2 },
    { ...valid(), protocolVersion: 'v2' },
    { ...valid(), role: 'answerer' },
    { ...valid(), sessionOrigin: 'https://other.example' },
    { ...valid(), signalingUrl: 'wss://user:password@session.example/signal' },
    { ...valid(), signalingUrl: 'wss://session.example/signal?ticket=secret' },
    { ...valid(), signalingUrl: 'wss://session.example/signaling' },
    { ...valid(), expiresAt: NOW },
    { ...valid(), unexpected: 'field' },
  ]) {
    assert.throws(() => parseDesktopSignalingBootstrap(candidate, 'https://session.example', NOW))
  }
})

test('rejects overlong TURN lifetime and credentials attached to STUN discovery', () => {
  const overlong = valid()
  overlong.iceServers[1].expiresAt = overlong.expiresAt + 1
  assert.throws(() => parseDesktopSignalingBootstrap(overlong, 'https://session.example', NOW), /expiry/u)
  const credentialedStun = valid()
  credentialedStun.iceServers = [{ urls: 'stun:stun.example', username: 'x', credential: 'credential_123456789', expiresAt: NOW + 1 }]
  assert.throws(() => parseDesktopSignalingBootstrap(credentialedStun, 'https://session.example', NOW), /ICE configuration/u)
})
