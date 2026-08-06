import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'

const outputDirectory = await mkdtemp(join(process.cwd(), 'scripts', '.terminal-panel-input-queue-'))
await build({
  absWorkingDir: process.cwd(),
  bundle: true,
  entryPoints: ['src/components/terminalPanelInputQueue.ts'],
  format: 'esm',
  outdir: outputDirectory,
  platform: 'node',
})
const { MAX_PANEL_INPUT_QUEUE_BYTES, ServerTerminalInputQueue } = await import(
  pathToFileURL(join(outputDirectory, 'terminalPanelInputQueue.js')).href,
)

const tick = () => new Promise((resolve) => setImmediate(resolve))

function deferred() {
  let resolve
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

test.after(async () => {
  await rm(outputDirectory, { recursive: true, force: true })
})

test('server-backed terminal input remains ordered while the attachment is asynchronous', async () => {
  const first = deferred()
  const second = deferred()
  const writes = []
  const attachment = {
    async write(data) {
      writes.push(data)
      if (writes.length === 1) {
        await first.promise
      } else {
        await second.promise
      }
    },
    async detach() {},
  }
  const queue = new ServerTerminalInputQueue((error) => {
    throw error
  })

  queue.enqueue('first')
  queue.enqueue('second')
  queue.attach(attachment)
  assert.deepEqual(writes, ['first'])

  first.resolve()
  await tick()
  assert.deepEqual(writes, ['first', 'second'])

  second.resolve()
  await tick()
})

test('server-backed terminal input fails closed after an uncertain write failure', async () => {
  const writes = []
  const errors = []
  const attachment = {
    async write(data) {
      writes.push(data)
      if (data === 'bad') {
        throw new Error('disconnected')
      }
    },
    async detach() {},
  }
  const queue = new ServerTerminalInputQueue((error) => errors.push(error.message))

  queue.enqueue('bad')
  queue.enqueue('good')
  queue.attach(attachment)
  await tick()

  assert.deepEqual(writes, ['bad'])
  assert.deepEqual(errors, ['disconnected'])
})

test('presentation ownership changes discard stale queued input without failing the stream', async () => {
  const writes = []
  const errors = []
  let rejectOwnership = true
  const attachment = {
    async write(data) {
      writes.push(data)
      if (rejectOwnership) {
        throw Object.assign(new Error('terminal presentation is controlled by another attachment'), {
          code: 'forbidden',
          details: { reason: 'presentation_owner' },
        })
      }
    },
    async detach() {},
  }
  const queue = new ServerTerminalInputQueue((error) => errors.push(error.message))

  queue.attach(attachment)
  queue.enqueue('stale-emulator-reply')
  queue.enqueue('also-stale')
  await tick()
  assert.deepEqual(writes, ['stale-emulator-reply'])
  assert.deepEqual(errors, [])

  rejectOwnership = false
  queue.enqueue('after-takeover')
  await tick()
  assert.deepEqual(writes, ['stale-emulator-reply', 'after-takeover'])
  assert.deepEqual(errors, [])
})

test('server-backed terminal input bounds queued data by UTF-8 bytes', async () => {
  const writes = []
  const attachment = {
    async write(data) {
      writes.push(data)
    },
    async detach() {},
  }
  const queue = new ServerTerminalInputQueue(() => {})
  const maximumPayload = 'é'.repeat(MAX_PANEL_INPUT_QUEUE_BYTES / 2)

  queue.attach(attachment)
  queue.enqueue(maximumPayload)
  queue.enqueue('one-byte-overflow')
  await tick()

  assert.deepEqual(writes, [maximumPayload])
})

test('closed server-backed terminal input detaches a late attachment without writing queued input', async () => {
  const writes = []
  let detachCount = 0
  const attachment = {
    async write(data) {
      writes.push(data)
    },
    async detach() {
      detachCount += 1
    },
  }
  const queue = new ServerTerminalInputQueue(() => {})

  queue.enqueue('must not arrive after cleanup')
  queue.close()
  queue.attach(attachment)
  await tick()

  assert.deepEqual(writes, [])
  assert.equal(detachCount, 1)
})
