import assert from 'node:assert/strict'
import { build } from 'esbuild'
import test from 'node:test'

async function loadModule(entryPoint) {
  const result = await build({
    bundle: true,
    entryPoints: [entryPoint],
    format: 'esm',
    platform: 'node',
    target: 'node22',
    write: false,
  })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
}

test('Task 19 macro adapter snapshots direct capability injection', async () => {
  const { captureLegacyMacroSettingsCapability } = await loadModule('src/services/macros/legacyMacroSettingsCapability.ts')
  const api = {
    deleteSecret: async () => {},
    getDecryptedSecret: async () => 'secret',
    getMacros: async () => [{ id: 'original' }],
    getSecrets: async () => [],
    onMacrosChanged: () => () => {},
    resetMacros: async () => [],
    saveSecret: async () => ({ id: 'secret' }),
    updateMacros: async (macros) => macros,
  }

  const capability = captureLegacyMacroSettingsCapability(api)
  api.getMacros = async () => [{ id: 'replacement' }]
  assert.deepEqual(await capability.getMacros(), [{ id: 'original' }])
})

test('Task 19 recordings compatibility adapter snapshots direct capability injection', async () => {
  const { createLegacyRecordingsClient } = await loadModule('src/services/recordings/legacyRecordingsClient.ts')
  const api = {
    deleteTerminalRecordingById: async () => {},
    getTerminalRecordingState: async () => ({ sessionId: 'original' }),
    listTerminalRecordings: async () => [],
    onTerminalRecordingChanged: () => () => {},
    readTerminalRecordingChunk: async () => ({ content: '' }),
    revealTerminalRecordingById: async () => {},
    startTerminalRecording: async () => ({ sessionId: 'original' }),
    stopTerminalRecording: async () => ({ sessionId: 'original' }),
  }

  const client = createLegacyRecordingsClient(api)
  api.getTerminalRecordingState = async () => ({ sessionId: 'replacement' })
  assert.deepEqual(
    await client.getState('ignored'),
    { sessionId: 'original' },
  )
})
