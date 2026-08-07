import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [app, settingsWindow, dictationController, preload, declarations] = await Promise.all([
  readFile('src/App.tsx', 'utf8'),
  readFile('src/components/SettingsWindow.tsx', 'utf8'),
  readFile('src/workspace/useDictationController.ts', 'utf8'),
  readFile('electron/preload.ts', 'utf8'),
  readFile('src/vite-env.d.ts', 'utf8'),
])

test('Desktop dictation routes use one narrow validated host', () => {
  const rendererSource = `${app}\n${settingsWindow}\n${dictationController}`
  for (const method of [
    'getKeyStatus',
    'saveKey',
    'clearKey',
    'getMicrophonePermissionStatus',
    'requestMicrophonePermission',
    'transcribe',
  ]) {
    assert.match(rendererSource, new RegExp(`(?:dictationHost|terminayDictationHost)[\\s\\S]{0,40}\\??\\.${method}\\(`, 'u'))
  }
  assert.match(settingsWindow, /getParakeetStatus\(\)/u)
  assert.match(settingsWindow, /installParakeet\(\)/u)
  assert.match(settingsWindow, /setInterval\(\(\) =>/u)
  assert.match(settingsWindow, /settings-parakeet-progress/u)
  assert.doesNotMatch(
    rendererSource,
    /window\.terminay\.(?:getDictationOpenAiKeyStatus|saveDictationOpenAiKey|clearDictationOpenAiKey|getDictationMicrophonePermissionStatus|requestDictationMicrophonePermission|transcribeDictation)/u,
  )
  assert.match(preload, /DESKTOP_DICTATION_HOST_BRIDGE_VERSION = 1/u)
  assert.match(preload, /exposeInMainWorld\(\s*['"]terminayDictationHost['"]/u)
  assert.match(preload, /dictationHostText/u)
  assert.match(declarations, /terminayDictationHost\?:/u)
})
