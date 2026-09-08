import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { randomBytes } from 'node:crypto'

const directory = await mkdtemp(join(tmpdir(), 'terminay-desktop-hosted-pairing-'))
const output = join(directory, 'desktopPairing.mjs')
await build({
  alias: {
    '@terminay/protocol': fileURLToPath(new URL('../packages/protocol/src/index.ts', import.meta.url)),
  },
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  bundle: true,
  entryPoints: ['electron/remote/desktopPairing.ts'],
  format: 'esm',
  logLevel: 'silent',
  outfile: output,
  platform: 'node',
  target: 'node20',
})
const { establishDesktopDevicePairing, resolveDesktopPairingTarget } = await import(output)
test.after(async () => {
  await rm(directory, { force: true, recursive: true })
})

const sessionId = 'abc12345def67890abc12345def67890'
const fragment = randomBytes(32).toString('base64url')
const hostedUrl = `https://app.terminay.com/?s=${sessionId}&hostName=Studio-Mac#${fragment}`

test('a hosted link resolves to the session origin and is classified for the authenticated channel', () => {
  const target = resolveDesktopPairingTarget(hostedUrl)
  assert.equal(target.kind, 'hosted')
  assert.equal(target.origin, `https://${sessionId}.terminay.com`)
  assert.equal(target.label, 'Studio-Mac')
  const direct = resolveDesktopPairingTarget(`https://${sessionId}.terminay.com/v1/#${fragment}`)
  assert.equal(direct.kind, 'hosted')
  assert.equal(direct.origin, `https://${sessionId}.terminay.com`)
})

test('a standalone server link resolves to its literal origin and pairs on the channels', async () => {
  const directUrl = `https://box.example.test:8443/v1/?hostName=Studio-Box#${fragment}`
  const target = resolveDesktopPairingTarget(directUrl)
  assert.equal(target.kind, 'direct')
  // The origin is kept exactly as the operator wrote it: nothing is derived
  // from the hostname and no manager origin is contacted.
  assert.equal(target.origin, 'https://box.example.test:8443')
  assert.equal(target.label, 'Studio-Box')

  // Pairing goes to the same authenticated-channel path as a hosted link, so
  // no pairing material can reach the direct origin over HTTPS.
  let fetches = 0
  await assert.rejects(() => establishDesktopDevicePairing({
    deviceName: 'Terminay Desktop',
    pairingUrl: directUrl,
    async fetch() {
      fetches += 1
      throw new Error('must not fetch')
    },
    store: {
      createDeviceKey() { throw new Error('must not allocate a key before the transport verifies') },
      async saveDeviceIdentity() { throw new Error('must not store') },
    },
    hosted: { webrtcRuntimeRoot: undefined },
  }), /WebRTC runtime directory is unavailable/u)
  assert.equal(fetches, 0)

  // A direct link with an IP literal or a bare hostname is still a direct
  // target: neither is a hosted session id.
  assert.equal(resolveDesktopPairingTarget(`https://203.0.113.4:8443/v1/#${fragment}`).kind, 'direct')
  assert.equal(resolveDesktopPairingTarget(`https://box/v1/#${fragment}`).kind, 'direct')
})

test('Desktop never sends pairing material to a hosted origin over HTTP', async () => {
  let fetches = 0
  await assert.rejects(() => establishDesktopDevicePairing({
    deviceName: 'Terminay Desktop',
    pairingUrl: hostedUrl,
    async fetch() {
      fetches += 1
      throw new Error('must not fetch')
    },
    store: {
      createDeviceKey() { throw new Error('must not allocate a key before the transport verifies') },
      async saveDeviceIdentity() { throw new Error('must not store') },
    },
    hosted: { webrtcRuntimeRoot: undefined },
  }), /WebRTC runtime directory is unavailable/u)
  assert.equal(fetches, 0)
})

test('only a loopback embedded-server link keeps same-machine HTTP enrollment, and it carries no PIN', async () => {
  const loopbackUrl = `http://127.0.0.1:4321/#${new URLSearchParams({
    pairingExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    pairingSessionId: 'room-a',
    pairingToken: 'token-a-0123456789',
  }).toString()}`
  assert.equal(resolveDesktopPairingTarget(loopbackUrl).kind, 'loopback')
  const calls = []
  const result = await establishDesktopDevicePairing({
    deviceName: 'Terminay Desktop',
    pairingUrl: loopbackUrl,
    async fetch(input, init) {
      calls.push([input, JSON.parse(init.body)])
      return { ok: true, async json() { return { deviceId: 'device-a', deviceName: 'Terminay Desktop', ticket: 'ticket-a' } } }
    },
    store: {
      createDeviceKey() { return { keyRef: { keyId: 'key' }, publicKeyPem: 'PUBLIC' } },
      async saveDeviceIdentity() {},
    },
  })
  assert.equal(result.origin, 'http://127.0.0.1:4321')
  assert.equal(calls[0][0], 'http://127.0.0.1:4321/api/devices/enroll')
  assert.equal('pairingPin' in calls[0][1], false)
  assert.throws(() => resolveDesktopPairingTarget('https://server.example/#pairingToken=abc'), /Terminay pairing link/u)
})
