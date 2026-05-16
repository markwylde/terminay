import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, hkdfSync } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { transform } from 'esbuild'

const { WebRtcPairingManager } = await importWebRtcPairingManager()

test('WebRtcPairingManager creates compact v1 session-subdomain QR payloads with one-time rooms', () => {
  const payload = new WebRtcPairingManager().create({
    hostedDomain: 'terminay.com',
  })
  const url = new URL(payload.pairingUrl)

  assert.equal(payload.protocolVersion, 'v1')
  assert.match(payload.sessionId, /^[a-f0-9]{32}$/)
  assert.match(payload.roomId, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(payload.roomId, payload.sessionId)
  assert.equal(payload.pairing.sessionId, payload.roomId)
  assert.equal(url.hostname, `${payload.sessionId}.terminay.com`)
  assert.equal(url.pathname, '/v1/')
  assert.equal(url.search, '')
  assert.equal(url.searchParams.has('relayJoinToken'), false)
  assert.equal(url.searchParams.has('pairingToken'), false)
  assert.equal(url.searchParams.has('signalingAuthToken'), false)
  assert.equal(payload.signalingUrl, `wss://${payload.sessionId}.terminay.com/signal`)

  const qrSecret = url.hash.slice(1)
  assert.equal(qrSecret, payload.qrSecret)
  assert.equal(base64UrlToBytes(qrSecret).byteLength, 32)
})

test('WebRtcPairingManager v1 secrets match HKDF-SHA256 labels', () => {
  const payload = new WebRtcPairingManager().create({
    hostedDomain: 'remote.example.com',
  })
  const qrSecretBytes = base64UrlToBytes(payload.qrSecret)

  assert.equal(payload.relayJoinToken, deriveSecret(qrSecretBytes, 'terminay remote v1 relay join'))
  assert.equal(payload.pairing.token, deriveSecret(qrSecretBytes, 'terminay remote v1 pairing'))
  assert.equal(payload.signalingAuthToken, deriveSecret(qrSecretBytes, 'terminay remote v1 signaling hmac'))
  assert.equal(payload.assetInstallKey, deriveSecret(qrSecretBytes, 'terminay remote v1 asset install'))
  assert.equal(payload.csrfSeed, deriveSecret(qrSecretBytes, 'terminay remote v1 csrf seed'))
  assert.equal(payload.roomId, deriveSecret(qrSecretBytes, 'terminay remote v1 pairing room'))
  assert.equal(payload.relayJoinTokenHash, createHash('sha256').update(payload.relayJoinToken).digest('base64url'))
  assert.equal(new URL(payload.pairingUrl).hostname, `${payload.sessionId}.remote.example.com`)
})

test('WebRtcPairingManager reuses a supplied session id while rotating rooms', () => {
  const manager = new WebRtcPairingManager()
  const first = manager.create({ hostedDomain: 'remote.example.com' })
  const second = manager.create({
    hostedDomain: 'remote.example.com',
    sessionId: first.sessionId,
  })

  assert.equal(second.sessionId, first.sessionId)
  assert.notEqual(second.roomId, first.roomId)
  assert.notEqual(second.qrSecret, first.qrSecret)
  assert.equal(new URL(second.pairingUrl).hostname, `${first.sessionId}.remote.example.com`)
})

async function importWebRtcPairingManager() {
  const source = await readFile(new URL('../electron/remote/webrtc.ts', import.meta.url), 'utf8')
  const transformed = await transform(source, {
    format: 'esm',
    loader: 'ts',
    platform: 'node',
    target: 'node20',
  })
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-webrtc-test-'))
  const outputPath = join(tempDir, 'webrtc.mjs')
  await writeFile(outputPath, transformed.code)
  return import(outputPath)
}

function deriveSecret(qrSecretBytes, label) {
  return Buffer.from(
    hkdfSync('sha256', qrSecretBytes, Buffer.alloc(0), label, 32),
  ).toString('base64url')
}

function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  return Buffer.from(padded, 'base64')
}
