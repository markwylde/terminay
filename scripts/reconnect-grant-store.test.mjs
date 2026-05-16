import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { transform } from 'esbuild'

const {
  ReconnectGrantStore,
  createReconnectProof,
  resolveReconnectGrantLifetime,
} = await importReconnectGrantStore()

test('ReconnectGrantStore issues opaque grants and persists verifier records', async () => {
  const { filePath, store } = await createStore()
  const issued = await store.issueGrant({
    deviceId: 'device-1',
    origin: 'https://session-a.terminay.com#transport=webrtc:https://session-a.terminay.com',
    sessionId: 'session-a',
  })

  assert.match(issued.handle, /^[A-Za-z0-9_-]{43}$/)
  assert.match(issued.grant, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(issued.handle, issued.grant)
  assert.notEqual(issued.handle, 'device-1')
  assert.notEqual(issued.handle, 'session-a')
  assert.equal(issued.protocolVersion, 'v1')
  assert.equal(Date.parse(issued.expiresAt) - Date.parse(issued.issuedAt), 24 * 60 * 60 * 1000)

  const records = JSON.parse(await readFile(filePath, 'utf8'))
  assert.equal(records.length, 1)
  assert.equal(records[0].handle, issued.handle)
  assert.equal(records[0].origin, issued.origin)
  assert.equal(records[0].sessionId, issued.sessionId)
  assert.equal(typeof records[0].grantHash, 'string')
  assert.equal(typeof records[0].proofVerifier, 'string')
  assert.equal(JSON.stringify(records).includes(issued.grant), false)
})

test('ReconnectGrantStore validates proof once and records last use', async () => {
  const { now, store } = await createStore()
  const issued = await store.issueGrant({
    deviceId: 'device-2',
    origin: 'https://session-b.terminay.com#transport=webrtc:https://session-b.terminay.com',
    sessionId: 'session-b',
  })
  const challenge = await store.createChallenge({
    clientNonce: 'client-nonce',
    handle: issued.handle,
    origin: issued.origin,
    sessionId: issued.sessionId,
  })
  const proof = createReconnectProof(issued.grant, challenge.signingInput)

  const verified = await store.verifyProof({
    attemptId: challenge.payload.attemptId,
    clientNonce: 'client-nonce',
    handle: issued.handle,
    origin: issued.origin,
    proof,
  })

  assert.equal(verified.deviceId, 'device-2')
  assert.equal(verified.lastUsedAt, now().toISOString())
  await assert.rejects(
    store.verifyProof({
      attemptId: challenge.payload.attemptId,
      clientNonce: 'client-nonce',
      handle: issued.handle,
      origin: issued.origin,
      proof,
    }),
    /no longer valid/,
  )
})

test('ReconnectGrantStore rejects expired grants and expired challenges', async () => {
  const clock = { value: Date.parse('2026-05-16T10:00:00.000Z') }
  const { store } = await createStore(clock)
  const issued = await store.issueGrant({
    deviceId: 'device-3',
    lifetime: '1h',
    origin: 'https://session-c.terminay.com#transport=webrtc:https://session-c.terminay.com',
    sessionId: 'session-c',
  })

  clock.value += 60 * 60 * 1000 + 1
  assert.equal(store.getSummaryForDevice('device-3').status, 'expired')
  await assert.rejects(
    store.createChallenge({
      clientNonce: 'late-client',
      handle: issued.handle,
      origin: issued.origin,
      sessionId: issued.sessionId,
    }),
    /no longer valid/,
  )

  const challengeGrant = await store.issueGrant({
    deviceId: 'device-4',
    lifetime: '24h',
    origin: 'https://session-d.terminay.com#transport=webrtc:https://session-d.terminay.com',
    sessionId: 'session-d',
  })
  const challenge = await store.createChallenge({
    clientNonce: 'client-nonce',
    handle: challengeGrant.handle,
    origin: challengeGrant.origin,
  })
  const proof = createReconnectProof(challengeGrant.grant, challenge.signingInput)

  clock.value += 60 * 1000 + 1
  await assert.rejects(
    store.verifyProof({
      attemptId: challenge.payload.attemptId,
      clientNonce: 'client-nonce',
      handle: challengeGrant.handle,
      origin: challengeGrant.origin,
      proof,
    }),
    /expired/,
  )
})

test('ReconnectGrantStore rotates handles and invalidates the previous grant', async () => {
  const { store } = await createStore()
  const issued = await store.issueGrant({
    deviceId: 'device-5',
    lifetime: '7d',
    origin: 'https://session-e.terminay.com#transport=webrtc:https://session-e.terminay.com',
    sessionId: 'session-e',
  })

  const rotated = await store.rotateGrant({
    handle: issued.handle,
    lifetime: '7d',
    origin: issued.origin,
  })

  assert.notEqual(rotated.handle, issued.handle)
  assert.notEqual(rotated.grant, issued.grant)
  assert.equal(store.listActive().filter((grant) => grant.deviceId === 'device-5').length, 1)
  await assert.rejects(
    store.createChallenge({
      clientNonce: 'old-client',
      handle: issued.handle,
      origin: issued.origin,
      sessionId: issued.sessionId,
    }),
    /no longer valid/,
  )

  const challenge = await store.createChallenge({
    clientNonce: 'new-client',
    handle: rotated.handle,
    origin: rotated.origin,
    sessionId: rotated.sessionId,
  })
  const proof = createReconnectProof(rotated.grant, challenge.signingInput)
  const verified = await store.verifyProof({
    attemptId: challenge.payload.attemptId,
    clientNonce: 'new-client',
    handle: rotated.handle,
    origin: rotated.origin,
    proof,
  })

  assert.equal(verified.rotatedFromHandle, issued.handle)
})

test('ReconnectGrantStore revokes grants with device revocation', async () => {
  const { store } = await createStore()
  const issued = await store.issueGrant({
    deviceId: 'device-6',
    lifetime: 'until-revoked',
    origin: 'https://session-f.terminay.com#transport=webrtc:https://session-f.terminay.com',
    sessionId: 'session-f',
  })

  assert.equal(issued.expiresAt, null)
  await store.revokeForDevice('device-6')
  assert.equal(store.getSummaryForDevice('device-6').status, 'revoked')
  await assert.rejects(
    store.createChallenge({
      clientNonce: 'revoked-client',
      handle: issued.handle,
      origin: issued.origin,
      sessionId: issued.sessionId,
    }),
    /no longer valid/,
  )
})

test('ReconnectGrantStore binds challenges to exact origin and session', async () => {
  const { store } = await createStore()
  const issued = await store.issueGrant({
    deviceId: 'device-7',
    origin: 'https://session-g.terminay.com#transport=webrtc:https://session-g.terminay.com',
    sessionId: 'session-g',
  })

  await assert.rejects(
    store.createChallenge({
      clientNonce: 'wrong-origin',
      handle: issued.handle,
      origin: 'https://session-h.terminay.com#transport=webrtc:https://session-h.terminay.com',
      sessionId: issued.sessionId,
    }),
    /different origin/,
  )
  await assert.rejects(
    store.createChallenge({
      clientNonce: 'wrong-session',
      handle: issued.handle,
      origin: issued.origin,
      sessionId: 'session-h',
    }),
    /different session/,
  )
  assert.equal(resolveReconnectGrantLifetime('not-a-choice'), '24h')
})

async function createStore(clock = { value: Date.parse('2026-05-16T10:00:00.000Z') }) {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-reconnect-grant-test-'))
  const filePath = join(tempDir, 'reconnect-grants.json')
  const now = () => new Date(clock.value)
  const store = new ReconnectGrantStore(filePath, now)
  await store.load()
  return { filePath, now, store }
}

async function importReconnectGrantStore() {
  const source = await readFile(new URL('../electron/remote/reconnectGrantStore.ts', import.meta.url), 'utf8')
  const transformed = await transform(source, {
    format: 'esm',
    loader: 'ts',
    platform: 'node',
    target: 'node20',
  })
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-reconnect-grant-import-'))
  const outputPath = join(tempDir, 'reconnectGrantStore.mjs')
  await writeFile(outputPath, transformed.code)
  return import(outputPath)
}
