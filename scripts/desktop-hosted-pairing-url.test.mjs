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
  bundle: true,
  entryPoints: ['electron/remote/desktopPairing.ts'],
  format: 'esm',
  logLevel: 'silent',
  outfile: output,
  platform: 'node',
  target: 'node20',
})
const { establishDesktopDevicePairing } = await import(output)
test.after(async () => {
  await rm(directory, { force: true, recursive: true })
})

test('Desktop hosted pairing enrolls the session origin, not app.terminay.com', async () => {
  const sessionId = 'abc12345def67890abc12345def67890'
  const fragment = randomBytes(32).toString('base64url')
  const pairingUrl = `https://app.terminay.com/?s=${sessionId}&hostName=Studio-Mac#${fragment}`
  const calls = []
  const result = await establishDesktopDevicePairing({
    deviceName: 'Terminay Desktop',
    pairingPin: '123456',
    pairingUrl,
    async fetch(input, init) {
      calls.push([input, JSON.parse(init.body)])
      return {
        ok: true,
        async json() {
          return { deviceId: 'device-a', deviceName: 'Terminay Desktop', ticket: 'ticket-a' }
        },
      }
    },
    store: {
      createDeviceKey() {
        return { keyRef: 'key', publicKeyPem: 'PUBLIC' }
      },
      async saveDeviceIdentity() {},
    },
  })

  assert.equal(result.origin, `https://${sessionId}.terminay.com`)
  assert.equal(result.label, 'Studio-Mac')
  assert.equal(calls[0][0], `https://${sessionId}.terminay.com/api/devices/enroll`)
  assert.equal(calls[0][1].pairingPin, '123456')
  assert.notEqual(calls[0][1].pairingToken, fragment)
})
