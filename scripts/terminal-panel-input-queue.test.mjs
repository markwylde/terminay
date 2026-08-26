import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { decodeFrame, encodeFrame, DEFAULT_PROTOCOL_LIMITS } from '@terminay/protocol'
import { TerminayClient } from '@terminay/client-core'

const outputDirectory = await mkdtemp(join(process.cwd(), 'scripts', '.terminal-panel-input-queue-'))
await build({
  absWorkingDir: process.cwd(),
  bundle: true,
  entryPoints: ['src/components/terminalPanelInputQueue.ts'],
  format: 'esm',
  outdir: outputDirectory,
  platform: 'node',
})
const {
  MAX_PANEL_INPUT_QUEUE_BYTES,
  MAX_PANEL_PASTE_CHUNK_BYTES,
  ServerTerminalInputQueue,
} = await import(
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

function createDisconnectableTransport() {
  const frames = []
  const queued = []
  let waiter
  let closed = false
  const incoming = {
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (queued.length > 0) return Promise.resolve({ value: queued.shift(), done: false })
          if (closed) return Promise.resolve({ value: undefined, done: true })
          return new Promise((resolve) => { waiter = resolve })
        },
        return() {
          closed = true
          waiter?.({ value: undefined, done: true })
          waiter = undefined
          return Promise.resolve({ value: undefined, done: true })
        },
      }
    },
  }
  return {
    state: 'open',
    incoming,
    queuedBytes: 0,
    bufferedBytes: 0,
    frames,
    open: async () => {},
    async send(frame) { frames.push(decodeFrame(frame)) },
    waitForWritable: async () => {},
    async close() { this.disconnect() },
    onStateChange: () => () => {},
    disconnect() {
      closed = true
      waiter?.({ value: undefined, done: true })
      waiter = undefined
    },
    push(envelope) {
      const frame = encodeFrame(envelope, new Uint8Array(), DEFAULT_PROTOCOL_LIMITS)
      if (waiter !== undefined) {
        const resolve = waiter
        waiter = undefined
        resolve({ value: frame, done: false })
      } else {
        queued.push(frame)
      }
    },
  }
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

test('an outcome-unknown terminal command closes its queue and is never replayed on a replacement attachment', async () => {
  const transport = createDisconnectableTransport()
  const client = new TerminayClient({ transport, clientId: 'queue-unknown-outcome' })
  const connecting = client.connect()
  transport.push({
    type: 'server_hello',
    protocolVersion: 1,
    serverId: 'server-1',
    serverVersion: 'test',
    clientId: 'queue-unknown-outcome',
    capabilities: [],
    limits: DEFAULT_PROTOCOL_LIMITS,
    authScope: 'write',
  })
  await connecting

  const errors = []
  const queue = new ServerTerminalInputQueue((error) => errors.push(error))
  queue.attach({
    write(data) {
      return client.command('terminal.input', { attachmentId: 'attachment-old', data })
    },
    async detach() {},
  })

  queue.enqueue('uncertain')
  queue.enqueue('queued-after-uncertain')
  assert.equal(
    transport.frames.filter(({ envelope }) => envelope.type === 'command' && envelope.operation === 'terminal.input').length,
    1,
  )

  transport.disconnect()
  await tick()
  await tick()

  assert.equal(errors.length, 1)
  assert.equal(errors[0]?.name, 'CommandOutcomeUnknownError')

  const replacementWrites = []
  queue.enqueue('typed-after-failure')
  queue.attach({
    async write(data) { replacementWrites.push(data) },
    async detach() {},
  })
  await tick()

  assert.deepEqual(replacementWrites, [])
  assert.deepEqual(
    transport.frames
      .filter(({ envelope }) => envelope.type === 'command' && envelope.operation === 'terminal.input')
      .map(({ envelope }) => envelope.payload.data),
    ['uncertain'],
  )
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

test('large clipboard pastes are chunked in order and report their transport progress', async () => {
  const writes = []
  const progress = []
  const payload = 'é'.repeat(MAX_PANEL_INPUT_QUEUE_BYTES)
  const attachment = {
    async write(data) {
      writes.push(data)
    },
    async detach() {},
  }
  const queue = new ServerTerminalInputQueue(() => {})

  queue.attach(attachment)
  queue.enqueuePaste(payload, (update) => progress.push(update))
  queue.enqueue('\r')
  await tick()
  await tick()

  assert.equal(writes.join(''), `${payload}\r`)
  assert.ok(writes.length > 2)
  assert.ok(
    writes.slice(0, -1).every((chunk) => Buffer.byteLength(chunk) <= MAX_PANEL_PASTE_CHUNK_BYTES),
  )
  assert.deepEqual(progress[0], {
    completedBytes: 0,
    status: 'in_progress',
    totalBytes: Buffer.byteLength(payload),
  })
  assert.deepEqual(progress.at(-1), {
    completedBytes: Buffer.byteLength(payload),
    status: 'complete',
    totalBytes: Buffer.byteLength(payload),
  })
})

test('large clipboard paste progress yields to the renderer between delivered chunks', async () => {
  const frames = []
  const writes = []
  const progress = []
  const payload = 'x'.repeat(MAX_PANEL_INPUT_QUEUE_BYTES * 2)
  const attachment = {
    async write(data) {
      writes.push(data)
    },
    async detach() {},
  }
  const queue = new ServerTerminalInputQueue(
    () => {},
    () => {
      const frame = deferred()
      frames.push(frame)
      return frame.promise
    },
  )

  queue.attach(attachment)
  queue.enqueuePaste(payload, (update) => progress.push(update))
  await tick()

  assert.equal(writes.length, 1)
  assert.equal(progress.at(-1)?.completedBytes, MAX_PANEL_PASTE_CHUNK_BYTES)
  assert.equal(frames.length, 1)

  frames.shift().resolve()
  await tick()
  assert.equal(writes.length, 2)
  assert.equal(progress.at(-1)?.completedBytes, MAX_PANEL_PASTE_CHUNK_BYTES * 2)
  assert.equal(frames.length, 1)

  while (frames.length > 0) {
    frames.shift().resolve()
    await tick()
  }
  await tick()

  assert.equal(writes.join(''), payload)
  assert.deepEqual(progress.at(-1), {
    completedBytes: Buffer.byteLength(payload),
    status: 'complete',
    totalBytes: Buffer.byteLength(payload),
  })
})

test('stopping a large clipboard paste prevents its remaining chunks from being written', async () => {
  const firstWrite = deferred()
  const writes = []
  const progress = []
  const payload = 'x'.repeat(MAX_PANEL_INPUT_QUEUE_BYTES * 2)
  const attachment = {
    async write(data) {
      writes.push(data)
      if (writes.length === 1) await firstWrite.promise
    },
    async detach() {},
  }
  const queue = new ServerTerminalInputQueue(() => {})

  queue.attach(attachment)
  queue.enqueuePaste(payload, (update) => progress.push(update))
  queue.enqueue('\r')
  assert.equal(writes.length, 1)

  queue.cancelPaste()
  firstWrite.resolve()
  await tick()
  await tick()

  assert.deepEqual(writes, [payload.slice(0, MAX_PANEL_PASTE_CHUNK_BYTES), '\r'])
  assert.deepEqual(progress.at(-1), {
    completedBytes: 0,
    status: 'cancelled',
    totalBytes: Buffer.byteLength(payload),
  })
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
