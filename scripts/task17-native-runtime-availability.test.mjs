import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('optional native node-datachannel full-application E2E availability', async (t) => {
  const [rootManifest, serverManifest] = await Promise.all([
    readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../apps/terminay-server/package.json', import.meta.url), 'utf8').then(JSON.parse),
  ])
  for (const manifest of [rootManifest, serverManifest]) {
    assert.equal(manifest.dependencies?.['node-datachannel'], undefined)
    assert.equal(manifest.optionalDependencies?.['node-datachannel'], undefined)
  }
  let runtime
  try {
    runtime = await import('node-datachannel')
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      t.skip('node-datachannel is intentionally undeclared: its audited published prebuild is blocked by the native supply-chain decision')
      return
    }
    throw error
  }
  const candidate = runtime.default ?? runtime
  assert.equal(typeof candidate.PeerConnection, 'function')
  assert.equal(typeof candidate.cleanup, 'function')
})
