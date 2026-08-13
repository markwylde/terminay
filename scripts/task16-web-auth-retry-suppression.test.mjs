import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { build } from 'esbuild'
import { join } from 'node:path'
import test from 'node:test'

const directory = await mkdtemp(join(process.cwd(), '.web-auth-retry-'))
const policyBundle = join(directory, 'reconnectPolicy.mjs')
const controllerBundle = join(directory, 'rendererConnectionController.mjs')
await Promise.all([
  build({ entryPoints: ['src/web/reconnectPolicy.ts'], bundle: true, format: 'esm', platform: 'node', outfile: policyBundle, logLevel: 'silent' }),
  build({ entryPoints: ['src/shared/rendererConnectionController.ts'], bundle: true, format: 'esm', platform: 'node', outfile: controllerBundle, logLevel: 'silent' }),
])
const { reconnectNeedsFreshPairing } = await import(`${policyBundle}?test=${Date.now()}`)
const { RendererConnectionController } = await import(`${controllerBundle}?test=${Date.now()}`)
test.after(() => rm(directory, { force: true, recursive: true }))

const settle = async (condition) => {
  for (let index = 0; index < 30 && !condition(); index += 1)
    await new Promise((resolve) => setTimeout(resolve, 0))
}

test('authenticated reconnect rejection blocks the current generation without scheduling retry', async () => {
  const timers = []
  let acquisitions = 0
  const candidate = { disposed: 0, dispose() { this.disposed += 1 } }
  const controller = new RendererConnectionController({
    clock: {
      clearTimeout: () => undefined,
      setTimeout: (callback, delay) => { timers.push({ callback, delay }); return callback },
    },
    classifyFailure: (cause) => reconnectNeedsFreshPairing(cause)
      ? { disposition: 'blocked', reason: 'expired' }
      : { disposition: 'retryable', reason: 'offline' },
  })

  controller.connect('profile-a', {
    acquire: async () => { acquisitions += 1; return candidate },
    authenticate: async () => { throw new Error('Saved reconnect credentials were rejected during protocol handshake.') },
    resubscribe: async () => {},
    hydrate: async () => {},
    verify: async () => {},
  })

  await settle(() => controller.state.phase === 'blocked' && candidate.disposed === 1)
  assert.equal(controller.state.phase, 'blocked')
  assert.equal(controller.state.reason, 'expired')
  assert.equal(acquisitions, 1)
  assert.equal(candidate.disposed, 1)
  assert.deepEqual(timers, [])

  controller.retry()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(acquisitions, 1)
})

test('transient reconnect rejection remains retryable and Retry performs one fresh attempt', async () => {
  const timers = []
  let acquisitions = 0
  const controller = new RendererConnectionController({
    clock: {
      clearTimeout: () => undefined,
      setTimeout: (callback, delay) => { timers.push({ callback, delay }); return callback },
    },
    classifyFailure: (cause) => reconnectNeedsFreshPairing(cause)
      ? { disposition: 'blocked', reason: 'expired' }
      : { disposition: 'retryable', reason: 'offline' },
  })
  controller.connect('profile-a', {
    acquire: async () => {
      acquisitions += 1
      if (acquisitions === 1) throw new Error('Server reconnect request failed (502)')
      return { dispose() {} }
    },
    resubscribe: async () => {}, hydrate: async () => {}, verify: async () => {},
  })

  await settle(() => controller.state.phase === 'retry-wait')
  assert.equal(timers.length, 1)
  controller.retry()
  await settle(() => controller.state.phase === 'connected')
  assert.equal(acquisitions, 2)
})
