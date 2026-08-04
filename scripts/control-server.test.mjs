import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { connect } from 'node:net'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'

const { createControlServer } = await importBundled('../electron/control/server.ts')
const { createControlClient } = await importBundled('../electron/mcp/client.ts')
const { CONTROL_PROTOCOL_VERSION, encodeControlMessage } = await importBundled(
  '../electron/control/protocol.ts',
)

async function withSocket(run) {
  const dir = await mkdtemp(join(tmpdir(), 'terminay-control-'))
  const socketPath = join(dir, 'control.sock')
  await run(socketPath)
}

test('valid token is forwarded with its scope and the result returns to the client', async () => {
  await withSocket(async (socketPath) => {
    const seen = []
    const server = createControlServer({
      socketPath,
      resolveScope: (token) =>
        token === 'good' ? { sessionId: 'sess-1', webContentsId: 7 } : null,
      forward: async (scope, op, params) => {
        seen.push({ scope, op, params })
        return { ok: true, result: { echoed: op } }
      },
    })
    await server.start()
    const client = createControlClient({ socketPath, token: 'good' })
    try {
      const result = await client.request('write_terminal', { terminal: 'a', text: 'hi' })
      assert.deepEqual(result, { echoed: 'write_terminal' })
      assert.equal(seen.length, 1)
      assert.deepEqual(seen[0].scope, { sessionId: 'sess-1', webContentsId: 7 })
      assert.equal(seen[0].op, 'write_terminal')
      assert.deepEqual(seen[0].params, { terminal: 'a', text: 'hi' })
    } finally {
      client.close()
      await server.stop()
    }
  })
})

test('an unresolvable capability is rejected and never reaches forward', async () => {
  await withSocket(async (socketPath) => {
    let forwarded = false
    const server = createControlServer({
      socketPath,
      resolveScope: () => null,
      forward: async () => {
        forwarded = true
        return { ok: true, result: {} }
      },
    })
    await server.start()
    const client = createControlClient({ socketPath, token: 'nope' })
    try {
      await assert.rejects(
        () => client.request('list_terminals', {}),
        (error) => {
          assert.equal(error.code, 'invalid_token')
          return true
        },
      )
      assert.equal(forwarded, false)
    } finally {
      client.close()
      await server.stop()
    }
  })
})

test('missing capability and a forged caller pid never become authority', async () => {
  await withSocket(async (socketPath) => {
    let resolved = false
    const server = createControlServer({
      socketPath,
      resolveScope: () => {
        resolved = true
        return { sessionId: 'forged', webContentsId: 3 }
      },
      forward: async (scope) => ({ ok: true, result: { sessionId: scope.sessionId } }),
    })
    await server.start()
    try {
      const response = await rawRequest(socketPath, {
        id: 'forged-pid',
        version: CONTROL_PROTOCOL_VERSION,
        pid: process.pid,
        op: 'list_terminals',
        params: {},
      })
      assert.equal(response.ok, false)
      assert.equal(response.error.code, 'bad_request')
      assert.equal(resolved, false)
    } finally {
      await server.stop()
    }
  })
})

test('invalid and stale copied tokens are rejected without forwarding', async () => {
  await withSocket(async (socketPath) => {
    let forwarded = false
    const activeTokens = new Set(['active-token'])
    const server = createControlServer({
      socketPath,
      resolveScope: (token) =>
        activeTokens.has(token)
          ? { sessionId: 'owned-session', webContentsId: 4 }
          : null,
      forward: async () => {
        forwarded = true
        return { ok: true, result: {} }
      },
    })
    await server.start()
    try {
      for (const token of ['invalid-token', 'copied-then-revoked-token']) {
        const response = await rawRequest(socketPath, validRequest(`request-${token}`, token))
        assert.equal(response.ok, false)
        assert.equal(response.error.code, 'invalid_token')
      }
      assert.equal(forwarded, false)

      activeTokens.delete('active-token')
      const stale = await rawRequest(socketPath, validRequest('stale-active', 'active-token'))
      assert.equal(stale.ok, false)
      assert.equal(stale.error.code, 'invalid_token')
      assert.equal(forwarded, false)
    } finally {
      await server.stop()
    }
  })
})

test('oversized complete and unbounded partial frames close the connection without forwarding', async () => {
  await withSocket(async (socketPath) => {
    let forwarded = false
    const server = createControlServer({
      socketPath,
      maxFrameBytes: 128,
      resolveScope: () => ({ sessionId: 's', webContentsId: 1 }),
      forward: async () => {
        forwarded = true
        return { ok: true, result: {} }
      },
    })
    await server.start()
    try {
      await writeUntilClosed(socketPath, `${'x'.repeat(129)}\n`)
      await writeUntilClosed(socketPath, 'x'.repeat(129))
      assert.equal(forwarded, false)
    } finally {
      await server.stop()
    }
  })
})

test('malformed envelopes are rejected before capability resolution', async () => {
  await withSocket(async (socketPath) => {
    let resolved = false
    const server = createControlServer({
      socketPath,
      resolveScope: () => {
        resolved = true
        return { sessionId: 's', webContentsId: 1 }
      },
      forward: async () => ({ ok: true, result: {} }),
    })
    await server.start()
    try {
      const wrongVersion = await rawRequest(socketPath, {
        ...validRequest('wrong-version', 'token'),
        version: 999,
      })
      assert.equal(wrongVersion.ok, false)
      assert.equal(wrongVersion.error.code, 'bad_request')

      const unknownOp = await rawRequest(socketPath, {
        ...validRequest('unknown-op', 'token'),
        op: 'read_every_secret',
      })
      assert.equal(unknownOp.ok, false)
      assert.equal(unknownOp.error.code, 'bad_request')
      assert.equal(resolved, false)
    } finally {
      await server.stop()
    }
  })
})

test('per-connection concurrency and request deadlines are bounded', async () => {
  await withSocket(async (socketPath) => {
    let releaseFirst
    const server = createControlServer({
      socketPath,
      maxInFlight: 1,
      requestTimeoutMs: 40,
      resolveScope: () => ({ sessionId: 's', webContentsId: 1 }),
      forward: async (_scope, _op, params) => {
        if (params.mode === 'hang') {
          return new Promise((resolve) => {
            releaseFirst = resolve
          })
        }
        return { ok: true, result: {} }
      },
    })
    await server.start()
    const socket = await openSocket(socketPath)
    const responses = collectResponses(socket)
    try {
      socket.write(encodeControlMessage(validRequest('first', 'token', { mode: 'hang' })))
      socket.write(encodeControlMessage(validRequest('second', 'token')))

      const limited = await responses.next()
      assert.equal(limited.id, 'second')
      assert.equal(limited.error.code, 'limit_exceeded')

      const timedOut = await responses.next()
      assert.equal(timedOut.id, 'first')
      assert.equal(timedOut.error.code, 'timeout')
      releaseFirst?.({ ok: true, result: {} })
    } finally {
      socket.destroy()
      await server.stop()
    }
  })
})

test('caller close aborts an in-flight forward and oversized output becomes a bounded error', async () => {
  await withSocket(async (socketPath) => {
    let callerAborted = false
    const server = createControlServer({
      socketPath,
      maxResponseBytes: 256,
      resolveScope: () => ({ sessionId: 's', webContentsId: 1 }),
      forward: async (_scope, _op, params, { signal }) => {
        if (params.mode === 'hang') {
          await new Promise((resolve) => {
            signal.addEventListener('abort', () => {
              callerAborted = true
              resolve()
            }, { once: true })
          })
          return { ok: false, error: { code: 'cancelled', message: 'cancelled' } }
        }
        return { ok: true, result: { output: 'x'.repeat(1_000) } }
      },
    })
    await server.start()
    try {
      const oversized = await rawRequest(socketPath, validRequest('oversized-output', 'token'))
      assert.equal(oversized.ok, false)
      assert.equal(oversized.error.code, 'limit_exceeded')

      const socket = await openSocket(socketPath)
      socket.write(encodeControlMessage(validRequest('caller-close', 'token', { mode: 'hang' })))
      await new Promise((resolve) => setTimeout(resolve, 10))
      socket.destroy()
      await waitFor(() => callerAborted)
    } finally {
      await server.stop()
    }
  })
})

test('forward errors surface to the client with their code', async () => {
  await withSocket(async (socketPath) => {
    const server = createControlServer({
      socketPath,
      resolveScope: () => ({ sessionId: 's', webContentsId: 1 }),
      forward: async () => ({
        ok: false,
        error: { code: 'ambiguous_terminal', message: 'two match', candidates: ['a', 'b'] },
      }),
    })
    await server.start()
    const client = createControlClient({ socketPath, token: 't' })
    try {
      await assert.rejects(
        () => client.request('focus_terminal', { terminal: 'x' }),
        (error) => {
          assert.equal(error.code, 'ambiguous_terminal')
          assert.deepEqual(error.candidates, ['a', 'b'])
          return true
        },
      )
    } finally {
      client.close()
      await server.stop()
    }
  })
})

async function importBundled(relativePath) {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-control-bundle-'))
  const outputPath = join(tempDir, `${relativePath.split('/').pop()}.mjs`)
  await build({
    bundle: true,
    entryPoints: [new URL(relativePath, import.meta.url).pathname],
    format: 'esm',
    outfile: outputPath,
    platform: 'node',
    target: 'node20',
  })
  return import(outputPath)
}

function validRequest(id, token, params = {}) {
  return {
    id,
    token,
    version: CONTROL_PROTOCOL_VERSION,
    op: 'list_terminals',
    params,
  }
}

async function rawRequest(socketPath, request) {
  const socket = await openSocket(socketPath)
  const responses = collectResponses(socket)
  try {
    socket.write(encodeControlMessage(request))
    return await responses.next()
  } finally {
    socket.destroy()
  }
}

async function openSocket(socketPath) {
  const socket = connect(socketPath)
  socket.setEncoding('utf8')
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
  return socket
}

function collectResponses(socket) {
  let buffer = ''
  const queued = []
  const waiters = []
  socket.on('data', (chunk) => {
    buffer += chunk
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const value = JSON.parse(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
      const resolve = waiters.shift()
      if (resolve) resolve(value)
      else queued.push(value)
      newline = buffer.indexOf('\n')
    }
  })
  return {
    next: () =>
      queued.length > 0
        ? Promise.resolve(queued.shift())
        : new Promise((resolve) => waiters.push(resolve)),
  }
}

async function writeUntilClosed(socketPath, data) {
  const socket = await openSocket(socketPath)
  const closed = new Promise((resolve) => socket.once('close', resolve))
  socket.write(data)
  await closed
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for condition.')
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
