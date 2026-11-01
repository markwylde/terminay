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
  MAX_PANEL_PENDING_PASTE_BYTES,
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

/** A panel attachment whose writes settle only when the test settles them. */
function heldAttachment() {
  const writes = []
  const pending = []
  return {
    writes,
    settleNext(error) {
      const next = pending.shift()
      if (next === undefined) throw new Error('no write is in flight')
      if (error === undefined) next.resolve()
      else next.reject(error)
    },
    attachment: {
      write(data) {
        writes.push(data)
        return new Promise((resolve, reject) => pending.push({ resolve, reject }))
      },
      async detach() {},
    },
  }
}

function recordingAttachment() {
  const writes = []
  return {
    writes,
    attachment: {
      async write(data) {
        writes.push(data)
      },
      async detach() {},
    },
  }
}

const failWith = (code) => Object.assign(new Error(code), { code })

test('input queued behind an in-flight write survives an attachment handoff and reaches the replacement once, in order', async () => {
  const errors = []
  const queue = new ServerTerminalInputQueue((error) => errors.push(error))
  const old = heldAttachment()
  queue.attach(old.attachment)

  for (const key of ['r', 'e', 'a', 'd']) queue.enqueue(key)
  assert.deepEqual(old.writes, ['r'])

  // Congestion recovery begins: the panel's attachment is being replaced.
  queue.handoff()
  // The user keeps typing while the replacement attaches.
  for (const key of [' ', '_']) assert.equal(queue.enqueue(key), true)

  const replacement = recordingAttachment()
  queue.setPresentationRole('controller')
  queue.attach(replacement.attachment)
  await tick()
  // Nothing overtakes the write still in flight on the old attachment.
  assert.deepEqual(replacement.writes, [])

  old.settleNext()
  await tick()
  assert.deepEqual(old.writes, ['r'])
  assert.deepEqual(replacement.writes, ['e', 'a', 'd', ' ', '_'])
  assert.deepEqual(errors, [])
})

test('a write the replaced attachment refused before the PTY is sent once by the replacement', async () => {
  const errors = []
  const queue = new ServerTerminalInputQueue((error) => errors.push(error))
  const old = heldAttachment()
  queue.attach(old.attachment)
  queue.enqueue('a')
  queue.enqueue('b')

  queue.handoff()
  const replacement = recordingAttachment()
  queue.setPresentationRole('controller')
  queue.attach(replacement.attachment)

  // The server had already replaced the attachment the write named.
  old.settleNext(failWith('session_not_found'))
  await tick()

  assert.deepEqual(replacement.writes, ['a', 'b'])
  assert.deepEqual(errors, [])
})

test('a write whose outcome is unknown on the replaced attachment is never sent twice', async () => {
  const errors = []
  const notices = []
  const queue = new ServerTerminalInputQueue((error) => errors.push(error), undefined, notice => notices.push(notice))
  const old = heldAttachment()
  queue.attach(old.attachment)
  queue.enqueue('a')
  queue.enqueue('b')

  queue.handoff()
  const replacement = recordingAttachment()
  queue.setPresentationRole('controller')
  queue.attach(replacement.attachment)

  old.settleNext(failWith('unknown_command_outcome'))
  await tick()

  assert.deepEqual(replacement.writes, [])
  assert.equal(notices.length, 1)
  assert.equal(notices[0].kind, 'unknown_outcome')
  assert.equal(queue.isClosed, false)
  queue.enqueue('new-input')
  await tick()
  assert.deepEqual(replacement.writes, ['new-input'])
  assert.deepEqual(errors, [])
})

test('input held through a handoff is discarded, and further input refused, only when the replacement is read-only', async () => {
  const queue = new ServerTerminalInputQueue(() => {})
  queue.handoff()
  assert.equal(queue.enqueue('typed-while-attaching'), true)

  const replacement = recordingAttachment()
  queue.setPresentationRole('read_only')
  queue.attach(replacement.attachment)
  assert.equal(queue.enqueue('typed-while-observing'), false)
  await tick()
  assert.deepEqual(replacement.writes, [])

  // Taking control back sends only what is typed from then on.
  queue.setPresentationRole('controller')
  assert.equal(queue.enqueue('typed-in-control'), true)
  await tick()
  assert.deepEqual(replacement.writes, ['typed-in-control'])
})

test('a paste in progress resumes on the replacement attachment from its first unsent chunk', async () => {
  const progress = []
  const queue = new ServerTerminalInputQueue(() => {})
  const old = heldAttachment()
  const payload = 'x'.repeat(MAX_PANEL_INPUT_QUEUE_BYTES * 2)
  queue.attach(old.attachment)
  queue.enqueuePaste(payload, (update) => progress.push(update))
  queue.enqueue('\r')
  assert.equal(old.writes.length, 1)

  queue.handoff()
  const replacement = recordingAttachment()
  queue.setPresentationRole('controller')
  queue.attach(replacement.attachment)
  old.settleNext()
  for (let frame = 0; frame < 16; frame += 1) await tick()

  assert.equal([...old.writes, ...replacement.writes].join(''), `${payload}\r`)
  assert.equal(replacement.writes.at(-1), '\r')
  assert.deepEqual(progress.at(-1), {
    completedBytes: Buffer.byteLength(payload),
    status: 'complete',
    totalBytes: Buffer.byteLength(payload),
  })
})

test('binary mouse reports preserve owned bytes and order with Unicode text across handoff', async () => {
  const queue = new ServerTerminalInputQueue((error) => { throw error })
  queue.handoff()
  const bytes = Uint8Array.of(27, 91, 77, 32, 128, 255)
  const expected = new Uint8Array(bytes)
  assert.equal(queue.enqueue('é'), true)
  assert.equal(queue.enqueue(bytes), true)
  bytes.fill(0)
  queue.handoff()
  const next = recordingAttachment()
  queue.attach(next.attachment)
  await tick()
  assert.deepEqual(next.writes, [])
  queue.setPresentationRole('controller')
  await tick()
  assert.deepEqual(next.writes, ['é', expected])
  queue.setPresentationRole('read_only')
  assert.equal(queue.enqueue(expected), false)
  queue.close()
  assert.equal(queue.enqueue(expected), false)
})

test('binary reports use actual byte lengths for the bounded pending input queue', () => {
  const queue = new ServerTerminalInputQueue(() => {})
  queue.handoff()
  assert.equal(queue.enqueue(new Uint8Array(MAX_PANEL_INPUT_QUEUE_BYTES).fill(255)), true)
  assert.equal(queue.enqueue(Uint8Array.of(128)), false)
  queue.close()
})

for (const code of [undefined, 'terminal_attachment_replaced', 'unknown_command_outcome']) {
  test(`binary reports do not overtake or duplicate an in-flight replaced write (${code ?? 'success'})`, async () => {
    const errors = []
    const queue = new ServerTerminalInputQueue((error) => errors.push(error))
    const old = heldAttachment()
    const bytes = Uint8Array.of(27, 91, 77, 32, 128, 255)
    queue.attach(old.attachment)
    queue.enqueue(bytes)
    queue.enqueue('k')
    queue.handoff()
    const replacement = recordingAttachment()
    queue.attach(replacement.attachment)
    queue.setPresentationRole('controller')
    assert.deepEqual(replacement.writes, [])
    old.settleNext(code === undefined ? undefined : failWith(code))
    await tick()
    assert.deepEqual(replacement.writes, code === 'terminal_attachment_replaced' ? [bytes, 'k'] : code === 'unknown_command_outcome' ? [] : ['k'])
    assert.deepEqual(errors, [])
    queue.close()
  })
}

test('lease loss discards pending binary reports and prevents later writes on the old attachment', async () => {
  const queue = new ServerTerminalInputQueue(() => {})
  const old = heldAttachment()
  queue.attach(old.attachment)
  queue.enqueue('in-flight')
  queue.enqueue(Uint8Array.of(27, 91, 77, 32, 128, 255))
  queue.setPresentationRole('read_only')
  old.settleNext()
  await tick()
  assert.deepEqual(old.writes, ['in-flight'])
  assert.equal(queue.enqueue(Uint8Array.of(128)), false)
  queue.close()
})


test('overflow pauses only input, reports a notice, and requires explicit continuation', async () => {
  const notices = []; const errors = []; const writes = [];
  const queue = new ServerTerminalInputQueue(error => errors.push(error), undefined, notice => notices.push(notice));
  queue.enqueue('x'.repeat(MAX_PANEL_INPUT_QUEUE_BYTES));
  assert.equal(queue.enqueue('overflow'), false);
  assert.equal(notices[0].kind, 'overflow');
  assert.equal(queue.isClosed, false);
  assert.equal(queue.enqueue('still-paused'), false);
  queue.attach({ write: async data => writes.push(data), detach: async () => {} });
  assert.equal(queue.resumeInput(), true);
  queue.enqueue('fresh'); await tick();
  assert.deepEqual(writes, ['fresh']); assert.deepEqual(errors, []);
  queue.close();
});

test('unknown handoff outcome cancels a paste and refuses input until replacement hydration', async () => {
  const notices = []; const progress = []; const old = heldAttachment();
  const queue = new ServerTerminalInputQueue(() => {}, undefined, notice => notices.push(notice));
  queue.attach(old.attachment);
  queue.enqueuePaste('paste'.repeat(20000), next => progress.push(next));
  queue.enqueue('submit\r'); queue.handoff();
  old.settleNext(failWith('unknown_command_outcome')); await tick();
  assert.equal(progress.at(-1).status, 'cancelled');
  assert.equal(notices[0].kind, 'unknown_outcome');
  assert.equal(queue.enqueue('before-hydration'), false);
  const replacement = recordingAttachment(); queue.attach(replacement.attachment);
  assert.equal(queue.enqueue('before-role'), false);
  queue.setPresentationRole('controller');
  assert.equal(queue.enqueue('after-hydration'), true); await tick();
  assert.deepEqual(replacement.writes, ['after-hydration']);
  assert.equal(queue.retainedPasteBytes, 0); queue.close();
});

test('large pastes have an aggregate retained-byte bound with visible overflow', () => {
  const notices = []; const progress = [];
  const queue = new ServerTerminalInputQueue(() => {}, undefined, notice => notices.push(notice));
  const paste = 'p'.repeat(6 * 1024 * 1024);
  queue.enqueuePaste(paste, next => progress.push(next));
  queue.enqueuePaste(paste, next => progress.push(next));
  assert.equal(queue.retainedPasteBytes, 12 * 1024 * 1024);
  queue.enqueuePaste(paste, next => progress.push(next));
  assert.equal(notices[0].kind, 'overflow');
  assert.ok(queue.retainedPasteBytes <= MAX_PANEL_PENDING_PASTE_BYTES);
  assert.equal(queue.retainedPasteBytes, 0);
  assert.equal(progress.filter(next => next.status === 'cancelled').length, 2);
  queue.close();
});

test('cancelled in-flight paste remains charged until its write settles', async () => {
  const old = heldAttachment(); const queue = new ServerTerminalInputQueue(() => {});
  queue.attach(old.attachment);
  const paste = 'p'.repeat(100000);
  queue.enqueuePaste(paste, () => {});
  queue.cancelPaste();
  assert.equal(queue.retainedPasteBytes, paste.length);
  old.settleNext(); await tick();
  assert.equal(queue.retainedPasteBytes, 0); queue.close();
});


test('overflow followed by an uncertain handoff does not leave input silently paused', async () => {
  const notices = []; const old = heldAttachment();
  const queue = new ServerTerminalInputQueue(() => {}, undefined, notice => notices.push(notice));
  queue.attach(old.attachment); queue.enqueue('a');
  queue.enqueue('x'.repeat(MAX_PANEL_INPUT_QUEUE_BYTES));
  assert.equal(notices.at(-1).kind, 'overflow');
  queue.handoff(); const replacement = recordingAttachment();
  queue.attach(replacement.attachment); queue.setPresentationRole('controller');
  old.settleNext(failWith('unknown_command_outcome')); await tick();
  assert.equal(notices.at(-1).kind, 'unknown_outcome');
  assert.equal(queue.enqueue('fresh'), true); await tick();
  assert.deepEqual(replacement.writes, ['fresh']); queue.close();
});

for (const failure of [new Error('transport ended'), failWith('unknown_command_outcome')]) {
  test(`overflow does not hide a current-attachment failure (${failure.message})`, async () => {
    const errors = []; const old = heldAttachment();
    const queue = new ServerTerminalInputQueue(error => errors.push(error));
    queue.attach(old.attachment); queue.enqueue('a');
    queue.enqueue('x'.repeat(MAX_PANEL_INPUT_QUEUE_BYTES));
    old.settleNext(failure); await tick();
    assert.equal(queue.isClosed, true); assert.deepEqual(errors, [failure]);
  });
}

for (const kind of ['overflow', 'unknown_outcome']) {
 test(`${kind} notice waits through pending and read-only replacements`, async () => {
  const notices = []; const errors = []; const old = heldAttachment();
  const queue = new ServerTerminalInputQueue(error => errors.push(error), undefined, notice => notices.push(notice));
  queue.attach(old.attachment);
  queue.enqueue('old');
  if (kind === 'overflow') queue.enqueue('x'.repeat(MAX_PANEL_INPUT_QUEUE_BYTES + 1));
  queue.handoff();
  if (kind === 'unknown_outcome') old.settleNext(failWith('unknown_command_outcome'));
  else old.settleNext();
  await tick();
  assert.equal(notices.at(-1).canContinue, false);
  assert.equal(queue.resumeInput(), false);
  const writes = [];
  queue.setPresentationRole('read_only');
  queue.attach({ write: async data => writes.push(data), detach: async () => {} });
  assert.equal(notices.at(-1), null);
  assert.equal(queue.resumeInput(), false);
  assert.equal(queue.enqueue('ignored'), false);
  queue.setPresentationRole('controller');
  assert.equal(notices.at(-1).canContinue, true);
  assert.equal(queue.resumeInput(), true);
  queue.enqueue('new'); await tick();
  assert.deepEqual(writes, ['new']); assert.deepEqual(errors, []);
 });
}

test('a terminal write queued in SDK admission resends exactly once after replacement', async () => {
 const transport = createDisconnectableTransport();
 const client = new TerminayClient({ transport, clientId: 'queued-input' });
 const connecting = client.connect();
 transport.push({ type: 'server_hello', protocolVersion: 1, serverId: 'server-1', serverVersion: 'test', clientId: 'queued-input', capabilities: [], limits: DEFAULT_PROTOCOL_LIMITS, authScope: 'write' });
 await connecting;
 const held = Array.from({ length: 128 }, () => client.query('review.hold').catch(() => {}));
 const errors = []; const writes = [];
 const queue = new ServerTerminalInputQueue(error => errors.push(error));
 queue.attach({ write: data => client.command('terminal.input', { data }), detach: async () => {} });
 queue.enqueue('prefix'); queue.enqueue('suffix');
 assert.equal(client.requestAdmission.waiting.length, 1);
 assert.equal(transport.frames.filter(frame => frame.envelope.operation === 'terminal.input').length, 0);
 queue.handoff(); transport.disconnect();
 queue.attach({ write: async data => writes.push(data), detach: async () => {} });
 queue.setPresentationRole('controller');
 await tick(); await Promise.all(held); await tick();
 assert.deepEqual(writes, ['prefix', 'suffix']);
 assert.deepEqual(errors, []);
 assert.equal(queue.isClosed, false);
 queue.close(); await client.close();
});

test('abort after admission grants a slot but before send transmits nothing', async () => {
 const transport = createDisconnectableTransport();
 const client = new TerminayClient({ transport, clientId: 'admission-abort' });
 const connecting = client.connect();
 transport.push({ type: 'server_hello', protocolVersion: 1, serverId: 'server-1', serverVersion: 'test', clientId: 'admission-abort', capabilities: [], limits: DEFAULT_PROTOCOL_LIMITS, authScope: 'write' });
 await connecting;
 const held = Array.from({ length: 128 }, () => client.query('review.hold').catch(() => {}));
 const controller = new AbortController();
 const queued = client.command('review.never', {}, { signal: controller.signal });
 const rejection = assert.rejects(queued, error => error.name === 'AbortError');
 const first = transport.frames.find(frame => frame.envelope.type === 'query').envelope;
 transport.push({ type: 'query_result', queryId: first.queryId, ok: true, result: null });
 // Wait for admission's synchronous drain, before the granted continuation.
 while (client.requestAdmission.waiting.length) await Promise.resolve();
 controller.abort('after grant');
 await rejection;
 assert.equal(transport.frames.filter(frame => frame.envelope.operation === 'review.never').length, 0);
 await client.close(); await Promise.all(held);
});

for (const kind of ['overflow', 'unknown_outcome']) {
 test(`${kind} notice clears when its queue closes`, async () => {
  const notices = []; const old = heldAttachment();
  const queue = new ServerTerminalInputQueue(() => {}, undefined, notice => notices.push(notice));
  queue.attach(old.attachment); queue.enqueue('old');
  if (kind === 'overflow') { queue.enqueue('x'.repeat(MAX_PANEL_INPUT_QUEUE_BYTES + 1)); old.settleNext(); }
  else { queue.handoff(); old.settleNext(failWith('unknown_command_outcome')); }
  await tick(); assert.equal(notices.at(-1).kind, kind);
  queue.close(); assert.equal(notices.at(-1), null); assert.equal(queue.resumeInput(), false);
 });
}

test('an unknown write settling after a read-only replacement keeps its warning hidden until control returns', async () => {
 const notices = []; const old = heldAttachment(); const replacement = recordingAttachment();
 const queue = new ServerTerminalInputQueue(() => {}, undefined, notice => notices.push(notice));
 queue.attach(old.attachment); queue.enqueue('uncertain'); queue.enqueue('discard');
 queue.handoff(); queue.setPresentationRole('read_only'); queue.attach(replacement.attachment);
 old.settleNext(failWith('unknown_command_outcome')); await tick();
 assert.equal(notices.at(-1), null); assert.equal(queue.enqueue('refused'), false);
 queue.setPresentationRole('controller');
 assert.equal(notices.at(-1).kind, 'unknown_outcome'); assert.equal(notices.at(-1).canContinue, true);
 assert.deepEqual(replacement.writes, []);
 assert.equal(queue.resumeInput(), true); queue.enqueue('fresh'); await tick();
 assert.deepEqual(replacement.writes, ['fresh']); queue.close();
});
