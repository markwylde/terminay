import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'

const { createRemoteTransportRuntime } = await importTransportRuntime()

test('transport runtime treats v1 session subdomains as exact WebRTC origins', () => {
  mockBrowserLocation('https://0123456789abcdef0123456789abcdef.terminay.com/v1/')
  const runtime = createRemoteTransportRuntime()

  assert.equal(runtime.mode, 'webrtc')
  assert.equal(
    runtime.pairingOrigin,
    'https://0123456789abcdef0123456789abcdef.terminay.com#transport=webrtc',
  )
})

test('transport runtime treats future session protocol paths as WebRTC origins', () => {
  mockBrowserLocation('https://0123456789abcdef0123456789abcdef.terminay.com/v2/')
  const runtime = createRemoteTransportRuntime()

  assert.equal(runtime.mode, 'webrtc')
  assert.equal(
    runtime.pairingOrigin,
    'https://0123456789abcdef0123456789abcdef.terminay.com#transport=webrtc',
  )
})

test('transport runtime ignores old shared-origin WebRTC query hints on manager host', () => {
  mockBrowserLocation('https://app.terminay.com/connect?mode=webrtc&sessionId=session-v1')
  const runtime = createRemoteTransportRuntime()

  assert.equal(runtime.mode, 'local')
  assert.equal(runtime.pairingOrigin, 'https://app.terminay.com')
})

test('transport runtime keeps local network mode on localhost', () => {
  mockBrowserLocation('https://localhost:9443/')
  const runtime = createRemoteTransportRuntime()

  assert.equal(runtime.mode, 'local')
  assert.equal(runtime.pairingOrigin, 'https://localhost:9443')
})

test('transport runtime does not promote invalid sibling hosts to WebRTC', () => {
  mockBrowserLocation('https://bad_room.terminay.com/')
  const runtime = createRemoteTransportRuntime()

  assert.equal(runtime.mode, 'local')
  assert.equal(runtime.pairingOrigin, 'https://bad_room.terminay.com')
})

async function importTransportRuntime() {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-transport-test-'))
  const outputPath = join(tempDir, 'transport.mjs')
  await build({
    bundle: true,
    entryPoints: [new URL('../src/remote/services/transport.ts', import.meta.url).pathname],
    format: 'esm',
    outfile: outputPath,
    platform: 'browser',
    target: 'es2022',
  })
  return import(outputPath)
}

function mockBrowserLocation(href) {
  const url = new URL(href)
  const storage = new Map()
  globalThis.sessionStorage = {
    getItem(key) {
      return storage.get(key) ?? null
    },
    setItem(key, value) {
      storage.set(key, String(value))
    },
  }
  globalThis.window = {
    location: {
      href: url.href,
      hostname: url.hostname,
      origin: url.origin,
    },
  }
}
