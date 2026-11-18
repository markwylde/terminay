import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, hkdfSync } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

import { parseHostedEndpoints } from '../packages/protocol/dist/index.js'

const { WebRtcPairingManager } = await importWebRtcPairingManager()

const REMOTE = parseHostedEndpoints({
  appServer: 'https://app.remote.example.com',
  sessionServer: 'https://<session>.remote.example.com',
})
const LOOPBACK = parseHostedEndpoints({
  appServer: 'http://localhost:18080',
  sessionServer: 'http://<session>.localhost:18080',
})

test('WebRtcPairingManager creates compact v1 manager-origin QR payloads with one-time rooms', () => {
  const payload = new WebRtcPairingManager().create({
    hostName: 'Studio-Mac.local',
  })
  const url = new URL(payload.pairingUrl)

  assert.equal(payload.protocolVersion, 'v1')
  assert.match(payload.sessionId, /^[a-f0-9]{32}$/)
  assert.match(payload.roomId, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(payload.roomId, payload.sessionId)
  assert.equal(payload.pairing.sessionId, payload.roomId)
  assert.equal(url.hostname, 'app.terminay.com')
  assert.equal(url.pathname, '/')
  assert.equal(url.searchParams.get('s'), payload.sessionId)
  assert.equal(url.searchParams.get('hostName'), 'Studio-Mac')
  assert.deepEqual([...url.searchParams.keys()].sort(), ['hostName', 'pairingExpiresAt', 's'])
  assert.equal(url.searchParams.has('relayJoinToken'), false)
  assert.equal(url.searchParams.has('pairingToken'), false)
  assert.equal(payload.appOrigin, `https://${payload.sessionId}.terminay.com`)
  assert.equal(payload.signalingUrl, `wss://${payload.sessionId}.terminay.com/signal`)

  const qrSecret = url.hash.slice(1)
  assert.equal(qrSecret, payload.qrSecret)
  assert.equal(base64UrlToBytes(qrSecret).byteLength, 32)
})

test('WebRtcPairingManager omits hostName from the QR when it sanitizes empty', () => {
  const payload = new WebRtcPairingManager().create({
    hostName: '   ',
  })
  const url = new URL(payload.pairingUrl)
  assert.equal(url.searchParams.get('s'), payload.sessionId)
  assert.equal(url.searchParams.has('hostName'), false)
  assert.equal(url.hash.slice(1), payload.qrSecret)
})

test('WebRtcPairingManager v1 secrets match HKDF-SHA256 labels', () => {
  const payload = new WebRtcPairingManager().create({
    hostedEndpoints: REMOTE,
  })
  const qrSecretBytes = base64UrlToBytes(payload.qrSecret)

  assert.equal(payload.relayJoinToken, deriveSecret(qrSecretBytes, 'terminay remote v1 relay join'))
  assert.equal(payload.pairing.token, deriveSecret(qrSecretBytes, 'terminay remote v1 pairing'))
  assert.equal(payload.assetInstallKey, deriveSecret(qrSecretBytes, 'terminay remote v1 asset install'))
  assert.equal(payload.csrfSeed, deriveSecret(qrSecretBytes, 'terminay remote v1 csrf seed'))
  assert.equal(payload.roomId, deriveSecret(qrSecretBytes, 'terminay remote v1 pairing room'))
  assert.equal(payload.relayJoinTokenHash, createHash('sha256').update(payload.relayJoinToken).digest('base64url'))
  assert.equal(new URL(payload.pairingUrl).hostname, 'app.remote.example.com')
  assert.equal(new URL(payload.pairingUrl).searchParams.get('s'), payload.sessionId)
})

test('WebRtcPairingManager reuses a supplied session id while rotating rooms', () => {
  const manager = new WebRtcPairingManager()
  const first = manager.create({ hostedEndpoints: REMOTE })
  const second = manager.create({
    hostedEndpoints: REMOTE,
    sessionId: first.sessionId,
  })

  assert.equal(second.sessionId, first.sessionId)
  assert.notEqual(second.roomId, first.roomId)
  assert.notEqual(second.qrSecret, first.qrSecret)
  assert.equal(new URL(second.pairingUrl).hostname, 'app.remote.example.com')
  assert.equal(new URL(second.pairingUrl).searchParams.get('s'), first.sessionId)
})

test('WebRtcPairingManager supports loopback endpoints for E2E', () => {
  const payload = new WebRtcPairingManager().create({
    hostedEndpoints: LOOPBACK,
  })
  const url = new URL(payload.pairingUrl)

  assert.equal(url.origin, 'http://localhost:18080')
  assert.equal(url.pathname, '/')
  assert.equal(url.searchParams.get('s'), payload.sessionId)
  assert.equal(payload.appOrigin, `http://${payload.sessionId}.localhost:18080`)
  assert.equal(payload.signalingUrl, `ws://${payload.sessionId}.localhost:18080/signal`)
})

test('WebRtcPairingManager advertises a preview manager and session origin', () => {
  const preview = parseHostedEndpoints({
    appServer: 'https://app-pr123.dev.terminay.com',
    sessionServer: 'https://<session>-pr123.dev.terminay.com',
  })
  const payload = new WebRtcPairingManager().create({ hostedEndpoints: preview })
  const url = new URL(payload.pairingUrl)

  assert.equal(url.origin, 'https://app-pr123.dev.terminay.com')
  assert.equal(url.searchParams.get('s'), payload.sessionId)
  assert.equal(payload.appOrigin, `https://${payload.sessionId}-pr123.dev.terminay.com`)
  assert.equal(payload.signalingUrl, `wss://${payload.sessionId}-pr123.dev.terminay.com/signal`)
})

async function importWebRtcPairingManager() {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-webrtc-test-'))
  const outputPath = join(tempDir, 'webrtc.mjs')
  await build({
    bundle: true,
    entryPoints: [fileURLToPath(new URL('../electron/remote/webrtc.ts', import.meta.url))],
    format: 'esm',
    logLevel: 'silent',
    outfile: outputPath,
    platform: 'node',
    target: 'node20',
    alias: {
      '@terminay/protocol': fileURLToPath(new URL('../packages/protocol/src/index.ts', import.meta.url)),
    },
  })
  return import(pathToFileURL(outputPath).href)
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
