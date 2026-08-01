import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { TerminayClient } from '@terminay/client-core'
import { createRemoteReconnectProof } from '@terminay/server-core'
import { createLocalUiServer } from '../apps/terminay-server/dist/index.js'

const directory = await mkdtemp(join(tmpdir(), 'terminay-desktop-reconnect-'))
const output = join(directory, 'desktopReconnect.mjs')
await build({
  bundle: true,
  entryPoints: ['electron/remote/desktopReconnect.ts'],
  format: 'esm',
  logLevel: 'silent',
  outfile: output,
  platform: 'node',
  target: 'node20',
})
const { createDesktopReconnectTransport } = await import(pathToFileURL(output).href)
test.after(async () => { await rm(directory, { recursive: true, force: true }) })

test('Desktop reconnect exchanges its protected grant for a short-lived protocol transport and opens the remote workspace', async () => {
  const grant = 'desktop-reconnect-grant-1234567890'
  const handle = 'h'.repeat(43)
  const ticket = 'desktop-reconnect-ticket-1234567890'
  let completeCalls = 0
  const server = createLocalUiServer({
    serverId: 'desktop-reconnect-server',
    serverVersion: '1.0.0',
    authToken: 'bootstrap-token-not-used-by-reconnect',
    acceptCredential: candidate => candidate === ticket,
    authorize: candidate => candidate === ticket ? 'admin' : null,
    capabilities: ['workspace.echo'],
    operations: {
      queries: {
        'workspace.echo': ({ envelope, context }) => ({ scope: context.authScope, payload: envelope.payload }),
      },
    },
    reconnect: {
      challenge: ({ handle: requestedHandle, clientNonce }) => {
        assert.equal(requestedHandle, handle)
        return { attemptId: 'desktop-attempt', handle, clientNonce, signingInput: `desktop-signing-input:${clientNonce}` }
      },
      complete: ({ attemptId, handle: requestedHandle, clientNonce, proof }) => {
        assert.equal(attemptId, 'desktop-attempt')
        assert.equal(requestedHandle, handle)
        assert.equal(proof, createRemoteReconnectProof(grant, `desktop-signing-input:${clientNonce}`))
        completeCalls += 1
        return { ticket, expiresAt: Date.now() + 60_000 }
      },
      enroll: () => { throw new Error('Desktop reconnect must not re-enroll a paired device') },
    },
  })
  const address = await server.start()
  assert.ok(address)
  const store = {
    async reconnectHandle(origin) {
      assert.equal(origin, address.origin)
      return handle
    },
    async proveReconnectChallenge(origin, signingInput) {
      assert.equal(origin, address.origin)
      return { handle, proof: createRemoteReconnectProof(grant, signingInput) }
    },
  }
  let client
  try {
    const connected = await createDesktopReconnectTransport({
      origin: address.origin,
      clientNonce: 'desktop-client-nonce-1234567890',
      store,
    })
    assert.equal(connected.origin, address.origin)
    assert.ok(connected.expiresAt > Date.now())
    client = new TerminayClient({
      transport: connected.transport,
      clientId: 'desktop-reconnect-client',
      clientVersion: '1.0.0',
      capabilities: ['workspace.echo'],
    })
    const hello = await client.connect()
    assert.deepEqual({ serverId: hello.serverId, authScope: hello.authScope }, { serverId: 'desktop-reconnect-server', authScope: 'admin' })
    const result = await client.query('workspace.echo', { source: 'desktop-reconnect' })
    assert.deepEqual(result.result, { scope: 'admin', payload: { source: 'desktop-reconnect' } })
  } finally {
    await client?.close().catch(() => undefined)
    await server.stop()
  }
  assert.equal(completeCalls, 1)
})

test('Desktop reconnect fails before network access when the protected grant is unavailable', async () => {
  let fetchCalls = 0
  await assert.rejects(() => createDesktopReconnectTransport({
    origin: 'https://server.example',
    store: {
      async reconnectHandle() { throw new Error('No reconnect grant exists for this paired device.') },
      async proveReconnectChallenge() { throw new Error('must not prove') },
    },
    fetch: async () => {
      fetchCalls += 1
      return { ok: false, json: async () => ({}) }
    },
  }), /No reconnect grant/u)
  assert.equal(fetchCalls, 0)
})

test('Desktop reconnect bounds and aborts a response body that stalls after headers', async () => {
  let requestSignal
  const startedAt = Date.now()
  await assert.rejects(() => createDesktopReconnectTransport({
    origin: 'https://server.example',
    clientNonce: 'desktop-client-nonce-1234567890',
    requestTimeoutMs: 1_000,
    store: {
      async reconnectHandle() { return 'h'.repeat(43) },
      async proveReconnectChallenge() { throw new Error('must not prove a stalled challenge') },
    },
    fetch: async (_url, init) => {
      requestSignal = init.signal
      return {
        ok: true,
        json: async () => new Promise(() => {}),
      }
    },
  }), /Desktop reconnect timed out/u)
  assert.equal(requestSignal?.aborted, true)
  assert.ok(Date.now() - startedAt < 2_000, 'stalled body must honor the configured request bound')
})
