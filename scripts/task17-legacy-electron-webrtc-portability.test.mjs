import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('the retired WebRTC compatibility service has no direct Electron runtime dependency', async () => {
  const source = await readFile(new URL('../electron/remote/service.ts', import.meta.url), 'utf8')
  const productionProof = await readFile(new URL('../e2e/webrtc-headless-node-host.spec.ts', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /from 'electron'/)
  assert.match(source, /userDataPath\?: string/)
  assert.match(source, /options\.userDataPath \?\? options\.app\?\.getPath\('userData'\)/)
  assert.match(productionProof, /userDataPath: userDataDir/)
  assert.doesNotMatch(productionProof, /app:\s*\{\s*getPath:/)
})
