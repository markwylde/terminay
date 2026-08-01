import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const directory = await mkdtemp(join(tmpdir(), 'terminay-device-pairing-flow-'))
const output = join(directory, 'devicePairingFlow.mjs')
await build({ bundle: true, entryPoints: ['src/remote/services/devicePairingFlow.ts'], format: 'esm', logLevel: 'silent', outfile: output, platform: 'node' })
const { establishDevicePairing } = await import(pathToFileURL(output).href)
test.after(async () => { await rm(directory, { recursive: true, force: true }) })

const bootstrap = { pairingExpiresAt: '2030-01-01T00:00:00.000Z', pairingSessionId: 'session-a', pairingToken: 'token-a' }

test('the transport-neutral device flow persists an origin-bound pairing and reconnect grant after the exact pairing exchange', async () => {
  const calls = []
  const stored = []
  const key = {}
  const api = {
    async postJson(pathname, body) {
      calls.push([pathname, body])
      if (pathname === '/api/pairing/start') return { provisionalDeviceId: 'pending-a' }
      if (pathname === '/api/pairing/complete') return {
        deviceId: 'device-a',
        deviceName: 'Desktop',
        reconnectGrant: { expiresAt: null, grant: 'grant-a', handle: 'handle-a', issuedAt: '2030-01-01T00:00:00.000Z', origin: 'https://server.example', protocolVersion: 'v1', sessionId: 'session-a' },
      }
      throw new Error(`unexpected ${pathname}`)
    },
  }
  const paired = await establishDevicePairing({
    api,
    bootstrap,
    credentials: {
      async saveEstablishedPairing(value) { stored.push(['established', value]) },
    },
    deviceName: 'Desktop',
    async generateKeyPair() { return { privateKey: key, publicKeyPem: 'PUBLIC-KEY' } },
    origin: 'https://server.example',
    pairingPin: '123456',
  })
  assert.equal(paired.deviceId, 'device-a')
  assert.deepEqual(calls, [
    ['/api/pairing/start', { deviceName: 'Desktop', pairingExpiresAt: bootstrap.pairingExpiresAt, pairingPin: '123456', pairingSessionId: 'session-a', pairingToken: 'token-a', publicKeyPem: 'PUBLIC-KEY' }],
    ['/api/pairing/complete', { provisionalDeviceId: 'pending-a' }],
  ])
  assert.deepEqual(stored, [
    ['established', { pairing: { deviceId: 'device-a', deviceName: 'Desktop', origin: 'https://server.example', privateKey: key, publicKeyPem: 'PUBLIC-KEY' }, reconnectGrant: paired.reconnectGrant }],
  ])
})

test('the flow fails closed instead of storing a reconnect grant for another origin', async () => {
  const stored = []
  await assert.rejects(() => establishDevicePairing({
    api: { async postJson(pathname) { return pathname.endsWith('/start') ? { provisionalDeviceId: 'pending-a' } : { deviceId: 'device-a', deviceName: 'Desktop', reconnectGrant: { expiresAt: null, grant: 'grant-a', handle: 'handle-a', issuedAt: '2030-01-01T00:00:00.000Z', origin: 'https://other.example', protocolVersion: 'v1', sessionId: 'session-a' } } } },
    bootstrap,
    credentials: { async saveEstablishedPairing(value) { stored.push(value) } },
    deviceName: 'Desktop',
    async generateKeyPair() { return { privateKey: {}, publicKeyPem: 'PUBLIC-KEY' } },
    origin: 'https://server.example',
    pairingPin: '123456',
  }), /different Terminay origin/)
  assert.equal(stored.length, 0, 'mismatched grants must not leave a partially persisted device pairing')
})

test('the flow accepts only a canonical same-origin WebRTC transport marker', async () => {
  const canonicalOrigin = 'https://session.example#transport=webrtc:https://session.example'
  const established = []
  const createApi = (grantOrigin = canonicalOrigin) => ({
    async postJson(pathname) {
      return pathname.endsWith('/start')
        ? { provisionalDeviceId: 'pending-webrtc' }
        : {
            deviceId: 'device-webrtc',
            deviceName: 'Browser',
            reconnectGrant: {
              expiresAt: null,
              grant: 'grant-webrtc',
              handle: 'handle-webrtc',
              issuedAt: '2030-01-01T00:00:00.000Z',
              origin: grantOrigin,
              protocolVersion: 'v1',
              sessionId: 'session-webrtc',
            },
          }
    },
  })
  await establishDevicePairing({
    api: createApi(),
    bootstrap,
    credentials: { async saveEstablishedPairing(value) { established.push(value) } },
    deviceName: 'Browser',
    async generateKeyPair() { return { privateKey: {}, publicKeyPem: 'PUBLIC-KEY' } },
    origin: canonicalOrigin,
    pairingPin: '123456',
  })
  assert.equal(established[0].pairing.origin, canonicalOrigin)

  for (const origin of [
    'https://session.example#transport=webrtc:https://other.example',
    'https://session.example#transport=webrtc:https://session.example#extra',
    'http://session.example#transport=webrtc:http://session.example',
  ]) {
    await assert.rejects(() => establishDevicePairing({
      api: createApi(origin),
      bootstrap,
      credentials: { async saveEstablishedPairing() {} },
      deviceName: 'Browser',
      async generateKeyPair() { return { privateKey: {}, publicKeyPem: 'PUBLIC-KEY' } },
      origin,
      pairingPin: '123456',
    }), /origin|HTTPS|credentials|path/)
  }
})

test('the flow accepts a canonical same-origin HTTPS WebRTC marker', async () => {
  const origin = 'https://session.example#transport=webrtc:https://session.example'
  const stored = []
  const paired = await establishDevicePairing({
    api: {
      async postJson(pathname) {
        if (pathname.endsWith('/start')) return { provisionalDeviceId: 'pending-a' }
        return {
          deviceId: 'device-a',
          deviceName: 'Browser',
          reconnectGrant: {
            expiresAt: null,
            grant: 'grant-a',
            handle: 'handle-a',
            issuedAt: '2030-01-01T00:00:00.000Z',
            origin,
            protocolVersion: 'v1',
            sessionId: 'session-a',
          },
        }
      },
    },
    bootstrap,
    credentials: { async saveEstablishedPairing(value) { stored.push(value) } },
    deviceName: 'Browser',
    async generateKeyPair() { return { privateKey: {}, publicKeyPem: 'PUBLIC-KEY' } },
    origin,
    pairingPin: '123456',
  })
  assert.equal(paired.deviceId, 'device-a')
  assert.equal(stored[0].pairing.origin, origin)
  assert.equal(stored[0].reconnectGrant.origin, origin)
})

test('the flow permits canonical same-origin loopback HTTP WebRTC markers for development', async () => {
  for (const baseOrigin of [
    'http://localhost:4317',
    'http://127.0.0.1:4317',
    'http://[::1]:4317',
  ]) {
    const origin = `${baseOrigin}#transport=webrtc:${baseOrigin}`
    const stored = []
    await establishDevicePairing({
      api: {
        async postJson(pathname) {
          if (pathname.endsWith('/start')) return { provisionalDeviceId: 'pending-a' }
          return {
            deviceId: 'device-a',
            deviceName: 'Browser',
            reconnectGrant: {
              expiresAt: null,
              grant: 'grant-a',
              handle: 'handle-a',
              issuedAt: '2030-01-01T00:00:00.000Z',
              origin,
              protocolVersion: 'v1',
              sessionId: 'session-a',
            },
          }
        },
      },
      bootstrap,
      credentials: { async saveEstablishedPairing(value) { stored.push(value) } },
      deviceName: 'Browser',
      async generateKeyPair() { return { privateKey: {}, publicKeyPem: 'PUBLIC-KEY' } },
      origin,
      pairingPin: '123456',
    })
    assert.equal(stored[0].pairing.origin, origin)
    assert.equal(stored[0].reconnectGrant.origin, origin)
  }
})

test('the flow rejects malformed or widened WebRTC origin markers before key generation', async () => {
  const invalidOrigins = [
    'https://session.example#transport=webrtc:https://relay.example',
    'https://session.example#transport=webrtc:https://session.example#transport=webrtc:https://session.example',
    'https://session.example#transport=webrtc:https://session.example#extra',
    'https://session.example?mode=pair#transport=webrtc:https://session.example',
    'https://user:password@session.example#transport=webrtc:https://session.example',
    'http://session.example#transport=webrtc:http://session.example',
    'https://session.example#transport=webrtc:',
    '#transport=webrtc:https://session.example',
    'not-an-origin#transport=webrtc:not-an-origin',
  ]
  for (const origin of invalidOrigins) {
    let generated = 0
    let apiCalls = 0
    let stored = 0
    await assert.rejects(() => establishDevicePairing({
      api: { async postJson() { apiCalls += 1; throw new Error('must not call API') } },
      bootstrap,
      credentials: { async saveEstablishedPairing() { stored += 1 } },
      deviceName: 'Browser',
      async generateKeyPair() {
        generated += 1
        return { privateKey: {}, publicKeyPem: 'PUBLIC-KEY' }
      },
      origin,
      pairingPin: '123456',
    }))
    assert.equal(generated, 0, `must reject before key generation: ${origin}`)
    assert.equal(apiCalls, 0, `must reject before API allocation: ${origin}`)
    assert.equal(stored, 0, `must reject before persistence: ${origin}`)
  }
})
