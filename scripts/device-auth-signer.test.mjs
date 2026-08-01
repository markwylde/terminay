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
        if (path === '/api/auth/options') return { deviceChallenge: { challengeId: 'challenge-a' }, signingInput: 'server-input' }
        return { ticket: 'ticket-a', websocketUrl: 'wss://server.example/socket' }
      },
    },
    deviceId: 'device-a',
    pairingPin: '123456',
    async signChallenge(value) {
      assert.equal(value, 'server-input')
      return 'main-process-signature'
    },
  })
  assert.deepEqual(result, { ticket: 'ticket-a', websocketUrl: 'wss://server.example/socket' })
  assert.deepEqual(calls, [
    ['/api/auth/options', { deviceId: 'device-a' }],
    ['/api/auth/verify', { challengeId: 'challenge-a', deviceId: 'device-a', deviceSignature: 'main-process-signature', pairingPin: '123456' }],
  ])
})
