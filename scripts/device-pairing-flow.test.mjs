import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const directory = await mkdtemp(join(tmpdir(), 'terminay-device-pairing-flow-'))
const output = join(directory, 'devicePairingFlow.mjs')
const authOutput = join(directory, 'auth.mjs')
await build({ bundle: true, entryPoints: ['src/remote/services/devicePairingFlow.ts'], format: 'esm', logLevel: 'silent', outfile: output, platform: 'node' })
await build({ bundle: true, entryPoints: ['src/remote/services/auth.ts'], format: 'esm', logLevel: 'silent', outfile: authOutput, platform: 'node' })
const { establishDevicePairing } = await import(pathToFileURL(output).href)
const { authenticateDevice } = await import(pathToFileURL(authOutput).href)
test.after(async () => { await rm(directory, { recursive: true, force: true }) })

const bootstrap = Object.freeze({
  pairingExpiresAt: '2030-01-01T00:00:00.000Z',
  pairingSessionId: 'session-a',
  pairingToken: 'token-a',
})

test('enrollment stores exactly one origin-bound device identity and keeps its ticket transient', async () => {
  const calls = []
  const stored = []
  const privateKey = {}
  const paired = await establishDevicePairing({
    api: {
      async postJson(pathname, body) {
        calls.push([pathname, body])
        return { deviceId: 'device-a', deviceName: 'Browser', ticket: 'ticket-a' }
      },
    },
    bootstrap,
    credentials: { async saveDeviceIdentity(identity) { stored.push(identity) } },
    deviceName: 'Browser',
    async generateKeyPair() { return { privateKey, publicKeyPem: 'PUBLIC-KEY' } },
    origin: 'https://server.example',
    pairingPin: '123456',
  })

  assert.deepEqual(calls, [[
    '/api/devices/enroll',
    {
      deviceName: 'Browser',
      pairingExpiresAt: bootstrap.pairingExpiresAt,
      pairingPin: '123456',
      pairingSessionId: bootstrap.pairingSessionId,
      pairingToken: bootstrap.pairingToken,
      publicKeyPem: 'PUBLIC-KEY',
    },
  ]])
  assert.deepEqual(stored, [{
    deviceId: 'device-a',
    deviceName: 'Browser',
    origin: 'https://server.example',
    privateKey,
  }])
  assert.deepEqual(paired, { deviceId: 'device-a', deviceName: 'Browser', ticket: 'ticket-a' })
  assert.equal('ticket' in stored[0], false)
})

test('enrollment rejects a non-canonical origin before allocating a key or contacting the server', async () => {
  for (const origin of [
    'http://server.example',
    'https://server.example/path',
    'https://server.example?query=1',
    'https://server.example#fragment',
    'https://user:password@server.example',
  ]) {
    let generated = 0
    let calls = 0
    await assert.rejects(() => establishDevicePairing({
      api: { async postJson() { calls += 1; throw new Error('must not call') } },
      bootstrap,
      credentials: { async saveDeviceIdentity() { throw new Error('must not store') } },
      deviceName: 'Browser',
      async generateKeyPair() { generated += 1; return { privateKey: {}, publicKeyPem: 'PUBLIC-KEY' } },
      origin,
      pairingPin: '123456',
    }), /exact HTTPS origin/)
    assert.equal(generated, 0)
    assert.equal(calls, 0)
  }
})

test('reconnect signs the server challenge then exchanges it for one connection ticket', async () => {
  const calls = []
  const authenticated = await authenticateDevice({
    api: {
      async postJson(pathname, body) {
        calls.push([pathname, body])
        if (pathname === '/api/devices/challenge') {
          return {
            challenge: {
              challengeId: 'challenge-a',
              deviceId: 'device-a',
              expiresAt: '2030-01-01T00:00:00.000Z',
              nonce: 'nonce-a',
              origin: 'https://server.example',
              serverId: 'server-a',
            },
            signingInput: 'server-a|https://server.example|device-a|nonce-a',
          }
        }
        return { ticket: 'ticket-a' }
      },
    },
    deviceId: 'device-a',
    origin: 'https://server.example',
    async signChallenge(input) {
      assert.equal(input, 'server-a|https://server.example|device-a|nonce-a')
      return 'signature-a'
    },
  })
  assert.deepEqual(authenticated, { ticket: 'ticket-a' })
  assert.deepEqual(calls, [
    ['/api/devices/challenge', { deviceId: 'device-a' }],
    ['/api/devices/verify', { challengeId: 'challenge-a', deviceId: 'device-a', deviceSignature: 'signature-a' }],
  ])
})

test('reconnect refuses an expired or cross-origin challenge before it can sign', async () => {
  for (const challenge of [
    { challengeId: 'challenge-a', deviceId: 'device-a', expiresAt: '2020-01-01T00:00:00.000Z', nonce: 'nonce-a', origin: 'https://server.example', serverId: 'server-a' },
    { challengeId: 'challenge-a', deviceId: 'device-a', expiresAt: '2030-01-01T00:00:00.000Z', nonce: 'nonce-a', origin: 'https://other.example', serverId: 'server-a' },
  ]) {
    let signatures = 0
    await assert.rejects(() => authenticateDevice({
      api: { async postJson() { return { challenge, signingInput: 'input-a' } } },
      deviceId: 'device-a',
      origin: 'https://server.example',
      async signChallenge() { signatures += 1; return 'must-not-sign' },
    }), /expired|different device or session origin/)
    assert.equal(signatures, 0)
  }
})
