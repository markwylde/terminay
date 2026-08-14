import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)

test('Task 19 server-frame adapter snapshots direct capability injection', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'terminay-task19-server-frame-'))
  try {
    const outfile = path.join(directory, 'capability.cjs')
    await build({ bundle: true, entryPoints: ['src/shared/legacyServerFrameCapability.ts'], format: 'cjs', logLevel: 'silent', outfile, platform: 'node' })
    const capabilityModule = require(outfile)
    const calls = []
    const api = {
      closeServerConnection: (serverId) => calls.push(['close', serverId]),
      sendServerFrame: (serverId, frame) => calls.push(['send', serverId, [...frame]]),
      onServerFrame: (serverId, listener) => {
        calls.push(['listen', serverId])
        listener(new Uint8Array([7]))
        return () => calls.push(['unsubscribe', serverId])
      },
    }
    const capability = capabilityModule.captureLegacyServerFrameCapability(api)
    api.sendServerFrame = () => { throw new Error('replaced broad host method must not be used') }
    api.onServerFrame = () => { throw new Error('replaced broad host method must not be used') }
    assert.equal(Object.isFrozen(capability), true)
    capability.closeServerConnection('server-a')
    capability.sendServerFrame('server-a', new Uint8Array([1, 2]))
    const unsubscribe = capability.onServerFrame('server-a', (frame) => calls.push(['frame', [...frame]]))
    unsubscribe()
    assert.deepEqual(calls, [
      ['close', 'server-a'],
      ['send', 'server-a', [1, 2]],
      ['listen', 'server-a'],
      ['frame', [7]],
      ['unsubscribe', 'server-a'],
    ])
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('Task 19 server-frame transport has no ambient preload acquisition', async () => {
  const [transport, runtime, entry] = await Promise.all([
    readFile('src/shared/rendererServerClient.ts', 'utf8'),
    readFile('src/rendererRuntime.tsx', 'utf8'),
    readFile('src/rendererApp.tsx', 'utf8'),
  ])
  assert.doesNotMatch(transport, /window\.terminay/u)
  assert.match(transport, /this\.frameCapability\.sendServerFrame/u)
  assert.match(transport, /this\.frameCapability\.onServerFrame/u)
  assert.match(runtime, /captureLegacyServerFrameCapability\(window\.terminayServerConnectionHost\)/u)
  assert.match(runtime, /preloadFrameCapability: serverFrameCapability/u)
  assert.doesNotMatch(entry, /configureLegacyServerFrameCompatibility/u)
})
