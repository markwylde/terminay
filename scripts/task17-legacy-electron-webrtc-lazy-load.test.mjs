import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Desktop has no legacy hidden WebRTC host activation or preload capability', async () => {
  const [source, preload, renderer] = await Promise.all([
    readFile(new URL('../electron/main.ts', import.meta.url), 'utf8'),
    readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/rendererRuntime.tsx', import.meta.url), 'utf8'),
  ])

  for (const value of [source, preload, renderer]) {
    assert.doesNotMatch(value, /remote-webrtc-host|terminay-legacy-webrtc-host|terminayWebRtcHost/u)
  }
  assert.doesNotMatch(source, /RemoteAccessService|remote\/service|createWebRtcHostWindow/u)
  assert.doesNotMatch(source, /TERMINAY_ENABLE_LEGACY_REMOTE_ACCESS/u)
  assert.doesNotMatch(renderer, /WebRtcHost|webrtc-host/u)
})
