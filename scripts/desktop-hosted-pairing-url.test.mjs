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
