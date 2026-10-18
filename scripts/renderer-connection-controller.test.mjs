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
/** Resolves on the first state the controller publishes in `phase`. */
const reach = (controller, phase) => new Promise((resolve) => {
  let reached = false
  let unsubscribe
  unsubscribe = controller.subscribe((state) => {
    if (reached || state.phase !== phase) return
    reached = true
    unsubscribe?.()
    resolve(state)
  })
  if (reached) unsubscribe()
})
/** A clock whose deadlines and retry pauses fire only if the test fires them. */
const heldClock = () => ({ clearTimeout: () => undefined, setTimeout: () => ({}) })
/** A promise, and the function a fake calls to settle it. */
const called = () => {
  let fire
  const happened = new Promise((resolve) => { fire = resolve })
  return { fire: (value) => fire(value), happened }
}

test('one controller activates only after the whole authenticated hydration pipeline', async () => {
  const order = []
  const activated = called()
  const controller = new RendererConnectionController({
    clock: heldClock(),
    onActivated: () => { order.push('activated'); activated.fire() },
  })
  controller.connect('server-a', {
    acquire: async () => { order.push('acquire'); return { dispose: () => order.push('dispose') } },
    authenticate: async () => order.push('authenticate'),
    resubscribe: async () => order.push('resubscribe'),
    hydrate: async () => order.push('hydrate'),
    verify: async () => order.push('verify'),
  })
  await activated.happened
  assert.equal(controller.state.phase, 'connected')
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
  await reach(controller, 'retry-wait')
  const connected = reach(controller, 'connected')
  retry()
  await connected
  assert.equal(acquisitions, 2)
})

test('late retired generation cannot replace the current client', async () => {
  const acquiring = called()
  const disposed = []
  const controller = new RendererConnectionController({ clock: heldClock() })
  const pipeline = (acquire) => ({ acquire, resubscribe: async () => {}, hydrate: async () => {}, verify: async () => {} })
  controller.connect('server-a', pipeline(() => new Promise((resolve) => acquiring.fire(resolve))))
  const release = await acquiring.happened
  controller.connect('server-a', pipeline(async () => ({ id: 'current', dispose: () => disposed.push('current') })))
  const connected = reach(controller, 'connected')
  release({ id: 'retired', dispose: () => disposed.push('retired') })
  await connected
  assert.equal(controller.current?.id, 'current')
  assert.deepEqual(disposed, ['retired'])
})

test('repeated Retry does not orphan an in-flight host endpoint acquisition', async () => {
  const acquiring = called()
  let acquisitions = 0
  const controller = new RendererConnectionController({ clock: heldClock() })
  controller.connect('server-a', {
    acquire: () => { acquisitions += 1; return new Promise((resolve) => acquiring.fire(resolve)) },
    resubscribe: async () => {}, hydrate: async () => {}, verify: async () => {},
  })
  const release = await acquiring.happened
  controller.retry()
  controller.retry()
  assert.equal(acquisitions, 1)
  const connected = reach(controller, 'connected')
  release({ dispose() {} })
  await connected
  assert.equal(acquisitions, 1)
})

test('a generation whose terminal hydration never settles becomes retryable and is replaced', async () => {
  const timers = []
  const disposed = []
  const verifying = called()
  let attempts = 0
  const controller = new RendererConnectionController({
    attemptTimeoutMs: 25,
    clock: {
      clearTimeout: (handle) => { handle.cleared = true },
      setTimeout: (callback, delay) => {
        const handle = { callback, cleared: false, delay }
        timers.push(handle)
        return handle
      },
    },
  })
  controller.connect('server-a', {
    acquire: async () => ({ id: ++attempts, dispose() { disposed.push(this.id) } }),
    resubscribe: async () => {},
    hydrate: async () => {},
    verify: async (candidate) => {
      if (candidate.id !== 1) return
      verifying.fire()
      await new Promise(() => {})
    },
  })
  // The generation is parked on the hydration step that never settles.
  await verifying.happened
  assert.equal(controller.state.phase, 'hydrating')
  const firstDeadline = timers.find((timer) => timer.delay === 25 && !timer.cleared)
  assert.ok(firstDeadline, 'the complete generation owns a deadline')
  const retryWait = reach(controller, 'retry-wait')
  firstDeadline.callback()
  await retryWait
  assert.deepEqual(disposed, [1])

  const connected = reach(controller, 'connected')
  controller.retry()
  await connected
  assert.equal(controller.current.id, 2)
})

test('stable client id replacement waits for retired client close', async () => {
  let releaseRetirement
  const retired = new Promise((resolve) => { releaseRetirement = resolve })
  let acquired = false
  const closing = called()
  const controller = new RendererConnectionController({ clock: heldClock() })
  const initial = controller.begin('server-a')
  await controller.activate(initial, { id: 'old', dispose: () => { closing.fire(); return retired } })
  controller.setRecoveryPipeline('server-a', {
    acquire: async () => { acquired = true; return { id: 'new', dispose() {} } },
    resubscribe: async () => {}, hydrate: async () => {}, verify: async () => {},
  })
  controller.recover('server-a')
  // The retired client has begun closing, and the new generation, started
  // before that, has still not acquired: it is waiting on the close.
  await closing.happened
  assert.equal(acquired, false)
  const connected = reach(controller, 'connected')
  releaseRetirement()
  await connected
  assert.equal(acquired, true)
  assert.equal(controller.current.id, 'new')
})

test('one generation-scoped protocol failure retires once and Retry acquires a fresh candidate', async () => {
  const timers = []
  const disposed = []
  const acquired = []
  let failReplacement = true
  const controller = new RendererConnectionController({
    clock: {
      clearTimeout: () => undefined,
      setTimeout: (callback, delay) => {
        timers.push({ callback, delay })
        return callback
      },
    },
  })
  const mountedAttempt = controller.begin('server-a')
  await controller.activate(mountedAttempt, {
    id: 'generation-1',
    dispose: () => disposed.push('generation-1'),
  })
  controller.setRecoveryPipeline('server-a', {
    acquire: async (attempt) => {
      acquired.push(attempt.generation)
      if (failReplacement) {
        failReplacement = false
        throw new Error('scripted relay outage')
      }
      return {
        id: `generation-${attempt.generation}`,
        dispose() { disposed.push(this.id) },
      }
    },
    resubscribe: async () => {}, hydrate: async () => {}, verify: async () => {},
  })

  // The protocol reader callback carries the exact attempt which mounted the
  // client. Repeated completion/error delivery for that attempt can start only
  // one replacement because recover synchronously advances generation identity.
  const reportProtocolFailure = () => {
    if (controller.isCurrent(mountedAttempt)) controller.recover('server-a')
  }
  const retryWait = reach(controller, 'retry-wait')
  reportProtocolFailure()
  reportProtocolFailure()
  await retryWait

  assert.deepEqual(disposed, ['generation-1'])
  assert.equal(acquired.length, 1)
  assert.notEqual(acquired[0], mountedAttempt.generation)

  const retry = controller.retry
  const connected = reach(controller, 'connected')
  retry()
  await connected
  assert.equal(acquired.length, 2)
  assert.ok(acquired[1] > acquired[0])
  assert.equal(controller.current.id, `generation-${acquired[1]}`)
})
