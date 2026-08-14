import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const settingsWindow = await readFile('src/components/SettingsWindow.tsx', 'utf8')
const settingsHook = await readFile('src/hooks/useTerminalSettings.ts', 'utf8')
const app = await readFile('src/App.tsx', 'utf8')
const remoteAccessController = await readFile('src/workspace/useRemoteAccessController.ts', 'utf8')
const macrosWindow = await readFile('src/components/MacrosWindow.tsx', 'utf8')
const task14 = await readFile('specs/tasks_completed/14-server-settings-secrets-and-macros.md', 'utf8')

test('production settings editor persists through the shared SettingsClient', () => {
  assert.match(settingsHook, /return \{ settings, isLoading, setSettings, settingsClient \}/)
  assert.match(settingsWindow, /settingsClient\.update<TerminalSettings>/)
  assert.match(settingsWindow, /settingsClient\.reset<TerminalSettings>/)
  assert.doesNotMatch(settingsWindow, /window\.terminay\.updateTerminalSettings/)
  assert.doesNotMatch(settingsWindow, /window\.terminay\.resetTerminalSettings/)
  assert.match(task14, /\[x\] Route the production settings editor's persisted updates and reset/)
})

test('workspace sidebar uses SettingsClient while Desktop pairing remains compatibility-host owned', () => {
  assert.match(app, /settingsClient\.update<TerminalSettings>/)
  assert.doesNotMatch(app, /settingsClient\.get<TerminalSettings>/)
  assert.doesNotMatch(
    app,
    /settingsClient\.update<TerminalSettings>\([\s\S]{0,500}?remoteAccess/u,
  )
  assert.match(remoteAccessController, /settingsClient\.get<TerminalSettings>\(\)/)
  assert.match(remoteAccessController, /settingsClient\.update<TerminalSettings>\(/)
  assert.doesNotMatch(remoteAccessController, /terminayTerminalSettingsCompatibilityHost/)
  assert.doesNotMatch(app, /window\.terminay\.(?:get|update)TerminalSettings/)
})

test('secret values remain behind privileged preload APIs', () => {
  assert.match(settingsWindow, /dictationHost\.saveKey/)
  assert.match(settingsWindow, /dictationHost\.clearKey/)
  assert.doesNotMatch(settingsWindow, /window\.terminay\.(?:saveDictationOpenAiKey|clearDictationOpenAiKey)/)
  assert.match(macrosWindow, /macroSettingsClient\.saveSecret/)
  assert.match(macrosWindow, /macroSettingsClient\.deleteSecret/)
  assert.doesNotMatch(macrosWindow, /useLegacyMacroSettingsCapability/)
  assert.doesNotMatch(macrosWindow, /window\.terminay\.(?:saveSecret|deleteSecret)/)
  assert.doesNotMatch(macrosWindow, /window\.terminay\.getDecryptedSecret/)
  assert.match(app, /macroSettingsCapability\.getDecryptedSecret/)
  assert.doesNotMatch(app, /window\.terminay\.getDecryptedSecret/)
})
