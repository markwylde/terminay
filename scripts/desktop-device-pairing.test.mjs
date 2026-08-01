import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const directory = await mkdtemp(join(tmpdir(), 'terminay-desktop-pairing-'))
const output = join(directory, 'desktopPairing.mjs')
await build({ bundle: true, entryPoints: ['electron/remote/desktopPairing.ts'], format: 'esm', logLevel: 'silent', outfile: output, platform: 'node', target: 'node20' })
const { establishDesktopDevicePairing } = await import(pathToFileURL(output).href)
test.after(async () => { await rm(directory, { recursive: true, force: true }) })

test('uses the canonical fragment-only start/complete exchange and persists through the injected Desktop store', async () => {
  const calls = []
  const saved = []
  const store = {
    createDeviceKey(origin) { return { keyRef: Object.freeze({ keyId: 'key-a' }), publicKeyPem: `public:${origin}` } },
    async saveEstablishedPairing(value) { saved.push(value) },
  }
  const paired = await establishDesktopDevicePairing({
    deviceName: 'Terminay Desktop',
    pairingPin: '123456',
    pairingUrl: 'https://server.example/#pairingSessionId=session-a&pairingToken=token-a&pairingExpiresAt=2030-01-01T00%3A00%3A00.000Z',
    store,
    fetch: async (url, init) => {
      calls.push([url, JSON.parse(init.body)])
      if (url.endsWith('/api/pairing/start')) return { ok: true, json: async () => ({ provisionalDeviceId: 'pending-a' }) }
      return { ok: true, json: async () => ({ deviceId: 'device-a', deviceName: 'Terminay Desktop', reconnectGrant: { expiresAt: null, grant: 'grant-a', handle: 'handle-a', issuedAt: '2029-01-01T00:00:00.000Z', origin: 'https://server.example', protocolVersion: 'v1', sessionId: 'session-a' } }) }
    },
  })
  assert.deepEqual(paired, { deviceId: 'device-a', deviceName: 'Terminay Desktop', origin: 'https://server.example' })
  assert.deepEqual(calls.map(([url]) => url), ['https://server.example/api/pairing/start', 'https://server.example/api/pairing/complete'])
  assert.equal(calls[0][1].pairingToken, 'token-a')
  assert.deepEqual(saved[0].pairing, { deviceId: 'device-a', deviceName: 'Terminay Desktop', origin: 'https://server.example', privateKey: { keyId: 'key-a' }, publicKeyPem: 'public:https://server.example' })
  assert.equal(saved[0].reconnectGrant.grant, 'grant-a')
})

test('does not write Desktop credentials when the pairing service returns a cross-origin reconnect grant', async () => {
  let writes = 0
  const store = {
    createDeviceKey() { return { keyRef: Object.freeze({ keyId: 'key-a' }), publicKeyPem: 'public' } },
    async saveEstablishedPairing() { writes += 1 },
  }
  await assert.rejects(() => establishDesktopDevicePairing({
    deviceName: 'Terminay Desktop', pairingPin: '123456',
    pairingUrl: 'https://server.example/#pairingSessionId=session-a&pairingToken=token-a&pairingExpiresAt=2030-01-01T00%3A00%3A00.000Z', store,
    fetch: async (url) => url.endsWith('/start')
      ? { ok: true, json: async () => ({ provisionalDeviceId: 'pending-a' }) }
      : { ok: true, json: async () => ({ deviceId: 'device-a', deviceName: 'Terminay Desktop', reconnectGrant: { expiresAt: null, grant: 'grant-a', handle: 'handle-a', issuedAt: '2029-01-01T00:00:00.000Z', origin: 'https://other.example', protocolVersion: 'v1', sessionId: 'session-a' } }) },
  }), /different Terminay origin/u)
  assert.equal(writes, 0)
})

test('bounds a stalled Desktop pairing request, aborts it, and never persists credentials', async () => {
  let aborted = false
  let writes = 0
  const store = {
    createDeviceKey() { return { keyRef: Object.freeze({ keyId: 'key-a' }), publicKeyPem: 'public' } },
    async saveEstablishedPairing() { writes += 1 },
  }
  await assert.rejects(() => establishDesktopDevicePairing({
    deviceName: 'Terminay Desktop',
    pairingPin: '123456',
    pairingRequestTimeoutMs: 1_000,
    pairingUrl: 'https://server.example/#pairingSessionId=session-a&pairingToken=token-a&pairingExpiresAt=2030-01-01T00%3A00%3A00.000Z',
    store,
    fetch: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        aborted = true
        reject(new Error('aborted'))
      }, { once: true })
    }),
  }), /pairing timed out/u)
  assert.equal(aborted, true)
  assert.equal(writes, 0)
})

test('rejects non-origin, credentialed, and non-loopback HTTP pairing URLs before network access', async () => {
  let calls = 0
  const store = {
    createDeviceKey() { throw new Error('must not create a key') },
    async saveEstablishedPairing() { throw new Error('must not persist') },
  }
  for (const pairingUrl of [
    'https://server.example/admin/#pairingSessionId=session-a&pairingToken=token-a&pairingExpiresAt=2030-01-01T00%3A00%3A00.000Z',
    'https://user:secret@server.example/#pairingSessionId=session-a&pairingToken=token-a&pairingExpiresAt=2030-01-01T00%3A00%3A00.000Z',
    'http://server.example/#pairingSessionId=session-a&pairingToken=token-a&pairingExpiresAt=2030-01-01T00%3A00%3A00.000Z',
  ]) {
    await assert.rejects(() => establishDesktopDevicePairing({
      deviceName: 'Terminay Desktop',
      pairingPin: '123456',
      pairingUrl,
      store,
      fetch: async () => {
        calls += 1
        return { ok: false, json: async () => ({}) }
      },
    }), /exact HTTPS or loopback HTTP origin/u)
  }
  assert.equal(calls, 0)
})

test('rejects expired or malformed pairing expiry before a request can consume the token', async () => {
  let calls = 0
  const store = {
    createDeviceKey() { throw new Error('must not create a key') },
    async saveEstablishedPairing() { throw new Error('must not persist') },
  }
  for (const pairingExpiresAt of ['not-a-date', '2000-01-01T00:00:00.000Z']) {
    await assert.rejects(() => establishDesktopDevicePairing({
      deviceName: 'Terminay Desktop',
      pairingPin: '123456',
      pairingUrl: `https://server.example/#pairingSessionId=session-a&pairingToken=token-a&pairingExpiresAt=${encodeURIComponent(pairingExpiresAt)}`,
      store,
      fetch: async () => {
        calls += 1
        return { ok: false, json: async () => ({}) }
      },
    }), /expired or has an invalid expiry/u)
  }
  assert.equal(calls, 0)
})
