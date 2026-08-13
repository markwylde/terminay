import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { build } from 'esbuild'
import { join } from 'node:path'
import test from 'node:test'
import { webcrypto } from 'node:crypto'

globalThis.crypto ??= webcrypto
const directory = await mkdtemp(join(process.cwd(), '.web-client-identity-'))
const bundle = join(directory, 'identity.mjs')
await build({ entryPoints: ['src/web/webClientIdentity.ts'], bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'silent' })
const { createWebClientId } = await import(`${bundle}?test=${Date.now()}`)
test.after(() => rm(directory, { force: true, recursive: true }))

test('each application transport generation has a unique protocol client id', () => {
  const ids = new Set(Array.from({ length: 1_000 }, () => createWebClientId()))
  assert.equal(ids.size, 1_000)
  for (const id of ids) assert.match(id, /^web-[0-9a-f-]{36}$/u)
})

test('webrtc generation identity is not the stable profile identity', () => {
  const profileId = 'web-stable-profile'
  const first = createWebClientId('web-webrtc')
  const replacement = createWebClientId('web-webrtc')
  assert.notEqual(first, replacement)
  assert.notEqual(first, profileId)
  assert.notEqual(replacement, profileId)
})
