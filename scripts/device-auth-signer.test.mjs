import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const directory = await mkdtemp(join(tmpdir(), 'terminay-device-auth-signer-'))
const output = join(directory, 'auth.mjs')
await build({ bundle: true, entryPoints: ['src/remote/services/auth.ts'], format: 'esm', logLevel: 'silent', outfile: output, platform: 'node' })
const { authenticateDevice } = await import(pathToFileURL(output).href)
test.after(async () => { await rm(directory, { recursive: true, force: true }) })

test('device authentication accepts an opaque signer and never requires a renderer CryptoKey', async () => {
  const calls = []
  const result = await authenticateDevice({
    api: {
      async postJson(path, body) {
        calls.push([path, body])
        if (path === '/api/devices/challenge') {
          return {
            challenge: { challengeId: 'challenge-a', deviceId: 'device-a', expiresAt: '2030-01-01T00:00:00.000Z', nonce: 'nonce-a', origin: 'https://server.example', serverId: 'server-a' },
            signingInput: 'server-input',
          }
        }
        return { ticket: 'ticket-a' }
      },
    },
    deviceId: 'device-a',
    origin: 'https://server.example',
    async signChallenge(value) {
      assert.equal(value, 'server-input')
      return 'main-process-signature'
    },
  })
  assert.deepEqual(result, { ticket: 'ticket-a' })
  assert.deepEqual(calls, [
    ['/api/devices/challenge', { deviceId: 'device-a' }],
    ['/api/devices/verify', { challengeId: 'challenge-a', deviceId: 'device-a', deviceSignature: 'main-process-signature' }],
  ])
})
