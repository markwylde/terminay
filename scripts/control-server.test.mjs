import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'

const { createControlServer } = await importBundled('../electron/control/server.ts')
const { createControlClient } = await importBundled('../electron/mcp/client.ts')

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

test('an unresolvable caller is rejected with not_in_terminay and never reaches forward', async () => {
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
          assert.equal(error.code, 'not_in_terminay')
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

test('scope is resolved from the client pid when no token is given', async () => {
  await withSocket(async (socketPath) => {
    let seenPid = null
    const server = createControlServer({
      socketPath,
      resolveScope: (token, pid) => {
        seenPid = pid
        return token ? null : { sessionId: 'by-pid', webContentsId: 3 }
      },
      forward: async (scope) => ({ ok: true, result: { sessionId: scope.sessionId } }),
    })
    await server.start()
    const client = createControlClient({ socketPath })
    try {
      const result = await client.request('list_terminals', {})
      assert.deepEqual(result, { sessionId: 'by-pid' })
      assert.equal(seenPid, process.pid)
    } finally {
      client.close()
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
