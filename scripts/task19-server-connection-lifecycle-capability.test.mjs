import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)

test('Task 19 server-connection lifecycle adapter snapshots direct capability injection', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'terminay-task19-server-lifecycle-'))
  try {
    const outfile = path.join(directory, 'capability.cjs')
    await build({ bundle: true, entryPoints: ['src/shared/legacyServerConnectionLifecycleCapability.ts'], format: 'cjs', logLevel: 'silent', outfile, platform: 'node' })
    const capabilityModule = require(outfile)
    const calls = []
    const api = {
      onServerConnection: (listener) => { calls.push('listen'); listener({ serverId: 'server-a' }); return () => calls.push('unsubscribe') },
      requestServerConnection: async (serverId) => { calls.push(['rehydrate', serverId]) },
    }
    const capability = capabilityModule.captureLegacyServerConnectionLifecycleCapability(api)
    api.onServerConnection = () => { throw new Error('replaced broad host method must not be used') }
    api.requestServerConnection = async () => { throw new Error('replaced broad host method must not be used') }
    assert.equal(Object.isFrozen(capability), true)
    const unsubscribe = capability.onServerConnection((message) => calls.push(['connection', message.serverId]))
    await capability.requestServerConnection('server-a')
    unsubscribe()
    assert.deepEqual(calls, ['listen', ['connection', 'server-a'], ['rehydrate', 'server-a'], 'unsubscribe'])
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('Task 19 renderer entry has no ambient server-connection lifecycle access', async () => {
  const entry = await Promise.all([
    readFile('src/rendererApp.tsx', 'utf8'),
    readFile('src/rendererRuntime.tsx', 'utf8'),
  ]).then((sources) => sources.join('\n'))
  assert.doesNotMatch(entry, /window\.terminay\.onServerConnection/u)
  assert.doesNotMatch(entry, /window\.terminay\s+as[\s\S]*?requestServerConnection/u)
  assert.match(entry, /captureLegacyServerConnectionLifecycleCapability\(\s*window\.terminayServerConnectionHost,?\s*\)/u)
  assert.doesNotMatch(entry, /configureLegacyServerConnectionLifecycleCompatibility/u)
})

test('Task 19 server lifecycle and frames leave the broad preload API', async () => {
  const [preload, declarations, compatibility] = await Promise.all([
    readFile('electron/preload.ts', 'utf8'),
    readFile('src/vite-env.d.ts', 'utf8'),
    readFile('src/types/terminay.ts', 'utf8'),
  ])
  assert.match(preload, /exposeInMainWorld\(\s*'terminayServerConnectionHost'/u)
  assert.match(preload, /DESKTOP_SERVER_CONNECTION_HOST_BRIDGE_VERSION = 1/u)
  assert.match(preload, /bytes\.byteLength > 16_777_216/u)
  assert.match(declarations, /terminayServerConnectionHost:/u)
  for (const operation of ['onServerConnection', 'requestServerConnection', 'sendServerFrame', 'onServerFrame']) {
    assert.doesNotMatch(compatibility, new RegExp(`^ {2}${operation}:`, 'mu'))
  }
})
