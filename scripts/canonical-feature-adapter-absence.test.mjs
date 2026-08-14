import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('canonical renderer contains no recording or macro compatibility adapter', async () => {
  const [recordings, controller, macros, macroHook, browserAdapters, declarations] = await Promise.all([
    read('src/components/RecordingsWindow.tsx'),
    read('src/workspace/useTerminalRecordingController.ts'),
    read('src/components/MacrosWindow.tsx'),
    read('src/hooks/useMacroSettings.ts'),
    read('src/web/browserRendererHostAdapters.ts'),
    read('src/vite-env.d.ts'),
  ])
  const combined = [recordings, controller, macros, macroHook, browserAdapters, declarations].join('\n')

  assert.doesNotMatch(combined, /legacyRecordingsClient|legacyClient|LegacyMacroSettingsCapability/u)
  assert.doesNotMatch(combined, /terminayRecordingServiceHost|terminayMacroSettingsCompatibilityHost/u)
  assert.doesNotMatch(recordings, /window\.terminay|terminayRecordingServiceHost/u)
  assert.match(recordings, /readonly client: RecordingsClient/u)
  assert.match(controller, /requireRecordingClient\(serverClient\)\.reveal\(recordingId\)/u)
  assert.match(controller, /RecordingCapabilityUnavailableError/u)
  assert.match(macros, /macroSettingsClient: MacroSettingsClient/u)
  assert.match(browserAdapters, /MacroSettingsUnavailableError/u)

  for (const path of [
    'src/services/recordings/legacyRecordingsClient.ts',
    'src/services/macros/legacyMacroSettingsCapability.ts',
  ]) {
    await assert.rejects(access(new URL(`../${path}`, import.meta.url)), { code: 'ENOENT' })
  }
})
