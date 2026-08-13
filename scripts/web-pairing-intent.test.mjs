import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { build } from 'esbuild'
import { join } from 'node:path'
import test from 'node:test'

const directory = await mkdtemp(join(process.cwd(), '.pairing-intent-'))
const bundle = join(directory, 'pairingIntent.mjs')
await build({ entryPoints: ['src/web/pairingIntent.ts'], bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'silent' })
const { PairingIntentController } = await import(`${bundle}?test=${Date.now()}`)
test.after(() => rm(directory, { force: true, recursive: true }))

test('pre-profile enrollment cancellation has no synthetic connection identity', () => {
  const controller = new PairingIntentController()
  const first = controller.begin()
  assert.deepEqual(Object.keys(first), ['revision'])
  controller.cancel()
  assert.equal(controller.isCurrent(first), false)
  const second = controller.begin()
  assert.equal(controller.isCurrent(second), true)
  assert.equal('profileId' in second, false)
})
