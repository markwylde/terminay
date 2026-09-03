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
  })

  assert.deepEqual(calls, [[
    '/api/devices/enroll',
    {
      deviceName: 'Browser',
      pairingExpiresAt: bootstrap.pairingExpiresAt,
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
    }), /exact HTTPS origin/)
    assert.equal(generated, 0)
    assert.equal(calls, 0)
  }
})

test('an authenticated lane parks enrollment, shows the match code, and completes only on approval', async () => {
  const { generateKeyPairSync } = await import('node:crypto')
  const { deriveMatchCode } = await import('../packages/protocol/dist/index.js')
  const key = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
  const secret = Buffer.alloc(32, 0x22).toString('base64url')
  const nonce = Buffer.alloc(32, 0x55).toString('base64url')
  const hostKey = Buffer.alloc(32, 0x11).toString('base64url')
  const shown = []
  const stored = []
  let waited
  const paired = await establishDevicePairing({
    api: {
      async postJson(pathname) {
        assert.equal(pathname, '/api/devices/enroll')
        return { status: 'pending', approvalId: 'approval-1', expiresAt: Date.now() + 120_000 }
      },
      async waitForEnrollmentDecision(approvalId, options) {
        waited = { approvalId, expiresAt: options.expiresAt }
        return { type: 'enrollment-approved', approvalId, deviceId: 'device-b', deviceName: 'Phone', ticket: 'T'.repeat(43) }
      },
    },
    bootstrap,
    credentials: { async saveDeviceIdentity(identity) { stored.push(identity) } },
    deviceName: 'Phone',
    async generateKeyPair() { return { privateKey: {}, publicKeyPem: key.publicKey } },
    origin: 'https://server.example',
    matchCode: { pairingSecret: secret, clientNonce: nonce, hostPublicKey: hostKey },
    onMatchCode: (code) => shown.push(code.matchCode),
  })
  assert.equal(waited.approvalId, 'approval-1')
  assert.deepEqual(shown, [await deriveMatchCode({ pairingSecret: secret, clientNonce: nonce, hostPublicKey: hostKey, devicePublicKeyPem: key.publicKey })])
  assert.equal(stored.length, 1, 'the credential is stored only after approval')
  assert.equal(paired.deviceId, 'device-b')

  await assert.rejects(() => establishDevicePairing({
    api: {
      async postJson() { return { status: 'pending', approvalId: 'approval-2', expiresAt: Date.now() + 120_000 } },
      async waitForEnrollmentDecision(approvalId) { return { type: 'enrollment-denied', approvalId, reason: 'denied' } },
    },
    bootstrap,
    credentials: { async saveDeviceIdentity() { throw new Error('must not store') } },
    deviceName: 'Phone',
    async generateKeyPair() { return { privateKey: {}, publicKeyPem: key.publicKey } },
    origin: 'https://server.example',
    matchCode: { pairingSecret: secret, clientNonce: nonce, hostPublicKey: hostKey },
  }), /denied this device/u)

  await assert.rejects(() => establishDevicePairing({
    api: { async postJson() { return { status: 'pending', approvalId: 'approval-3', expiresAt: Date.now() + 120_000 } } },
    bootstrap,
    credentials: { async saveDeviceIdentity() { throw new Error('must not store') } },
    deviceName: 'Phone',
    async generateKeyPair() { return { privateKey: {}, publicKeyPem: key.publicKey } },
    origin: 'https://server.example',
  }), /cannot wait for pairing approval/u)
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
