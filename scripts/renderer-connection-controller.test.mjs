import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { build } from 'esbuild'
import { join } from 'node:path'
import test from 'node:test'

const directory = await mkdtemp(join(process.cwd(), '.renderer-controller-'))
const bundle = join(directory, 'controller.mjs')
await build({ entryPoints: ['src/shared/rendererConnectionController.ts'], bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'silent' })
const { RendererConnectionController } = await import(`${bundle}?test=${Date.now()}`)
test.after(() => rm(directory, { force: true, recursive: true }))
const settle = async (condition) => {
  for (let index = 0; index < 20 && !condition(); index += 1)
    await new Promise((resolve) => setTimeout(resolve, 0))
}

test('one controller activates only after the whole authenticated hydration pipeline', async () => {
  const order = []
  const controller = new RendererConnectionController({ onActivated: () => order.push('activated') })
  controller.connect('server-a', {
    acquire: async () => { order.push('acquire'); return { dispose: () => order.push('dispose') } },
    authenticate: async () => order.push('authenticate'),
    resubscribe: async () => order.push('resubscribe'),
    hydrate: async () => order.push('hydrate'),
    verify: async () => order.push('verify'),
  })
  await settle(() => controller.state.phase === 'connected')
  assert.deepEqual(order, ['acquire', 'authenticate', 'resubscribe', 'hydrate', 'verify', 'activated'])
})

test('mounted Retry is stable after the disconnected client is retired', async () => {
  const timers = []
  let acquisitions = 0
  const controller = new RendererConnectionController({
    clock: { clearTimeout: () => undefined, setTimeout: (callback) => { timers.push(callback); return callback } },
  })
  const retry = controller.retry
  controller.connect('server-a', {
    acquire: async () => {
      acquisitions += 1
      if (acquisitions === 1) throw new Error('client is not connected')
      return { dispose() {} }
    },
    resubscribe: async () => {}, hydrate: async () => {}, verify: async () => {},
  })
  await settle(() => controller.state.phase === 'retry-wait')
  retry()
  await settle(() => controller.state.phase === 'connected')
  assert.equal(acquisitions, 2)
})

test('late retired generation cannot replace the current client', async () => {
  let release
  const disposed = []
  const controller = new RendererConnectionController()
  const pipeline = (acquire) => ({ acquire, resubscribe: async () => {}, hydrate: async () => {}, verify: async () => {} })
  controller.connect('server-a', pipeline(() => new Promise((resolve) => { release = resolve })))
  controller.connect('server-a', pipeline(async () => ({ id: 'current', dispose: () => disposed.push('current') })))
  release({ id: 'retired', dispose: () => disposed.push('retired') })
  await settle(() => controller.current?.id === 'current')
  assert.deepEqual(disposed, ['retired'])
})

test('another profile cannot recover or stop the current connection authority', async () => {
  const disposed = []
  const controller = new RendererConnectionController()
  controller.connect('server-a', {
    acquire: async () => ({ dispose: () => disposed.push('server-a') }),
    resubscribe: async () => {}, hydrate: async () => {}, verify: async () => {},
  })
  await settle(() => controller.state.phase === 'connected')
  controller.recover('server-b')
  await controller.stop('server-b')
  assert.equal(controller.state.phase, 'connected')
  assert.equal(controller.state.profileId, 'server-a')
  assert.deepEqual(disposed, [])
  await controller.stop('server-a')
  assert.equal(controller.state.phase, 'stopped')
  assert.deepEqual(disposed, ['server-a'])
})
