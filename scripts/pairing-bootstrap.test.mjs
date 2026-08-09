import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const directory = await mkdtemp(join(tmpdir(), 'terminay-pairing-bootstrap-'))
const output = join(directory, 'pairing.mjs')
await build({ bundle: true, entryPoints: ['src/remote/services/pairing.ts'], format: 'esm', logLevel: 'silent', outfile: output, platform: 'node' })
const { parsePairingBootstrap } = await import(pathToFileURL(output).href)
test.after(async () => { await rm(directory, { recursive: true, force: true }) })

const expiresAt = '2026-12-01T00:00:00.000Z'
const fragmentUrl = `https://server.example.test/#pairingExpiresAt=${encodeURIComponent(expiresAt)}&pairingSessionId=session-a&pairingToken=one-time-token`

test('pairing bootstrap is pure and accepts only an explicit fragment or JSON payload', () => {
  assert.deepEqual(parsePairingBootstrap(fragmentUrl), { pairingExpiresAt: expiresAt, pairingSessionId: 'session-a', pairingToken: 'one-time-token' })
  assert.deepEqual(parsePairingBootstrap(JSON.stringify({ pairingExpiresAt: expiresAt, pairingSessionId: 'session-a', pairingToken: 'one-time-token' })), { pairingExpiresAt: expiresAt, pairingSessionId: 'session-a', pairingToken: 'one-time-token' })
  assert.throws(() => parsePairingBootstrap(`https://server.example.test/?pairingExpiresAt=${encodeURIComponent(expiresAt)}&pairingSessionId=session-a&pairingToken=one-time-token`), /fragment/u)
})

test('rejects ambiguous or control-bearing pairing frames before a client can send their token', () => {
  assert.throws(
    () => parsePairingBootstrap(`https://server.example.test/#pairingExpiresAt=${encodeURIComponent(expiresAt)}&pairingSessionId=session-a&pairingSessionId=session-b&pairingToken=one-time-token`),
    /repeated pairingSessionId/u,
  )
  assert.throws(
    () => parsePairingBootstrap(`https://server.example.test/#pairingExpiresAt=${encodeURIComponent(expiresAt)}&pairingSessionId=session-a&pairingToken=${encodeURIComponent('token\u0000suffix')}`),
    /invalid pairingToken/u,
  )
})

test('rejects malformed and expired pairing frames at or before the current instant', () => {
  const boundary = Date.parse(expiresAt)
  assert.deepEqual(
    parsePairingBootstrap(fragmentUrl, boundary - 1),
    { pairingExpiresAt: expiresAt, pairingSessionId: 'session-a', pairingToken: 'one-time-token' },
  )
  assert.throws(() => parsePairingBootstrap(fragmentUrl, boundary), /expired or has an invalid expiry/u)
  assert.throws(() => parsePairingBootstrap(fragmentUrl, boundary + 1), /expired or has an invalid expiry/u)
  assert.throws(
    () => parsePairingBootstrap(JSON.stringify({ pairingExpiresAt: 'not-a-date', pairingSessionId: 'session-a', pairingToken: 'one-time-token' }), boundary),
    /expired or has an invalid expiry/u,
  )
})
