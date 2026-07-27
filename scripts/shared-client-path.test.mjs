import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const gateway = await readFile('src/services/fileViewer/terminayFileGateway.ts', 'utf8')
const compatibility = await readFile('src/services/fileViewer/legacyFileViewerTransport.ts', 'utf8')
const performantTextViewer = await readFile('src/components/file-viewer/modes/PerformantTextViewer.tsx', 'utf8')
const filePanel = await readFile('src/components/file-viewer/FilePanel.tsx', 'utf8')
const settingsHook = await readFile('src/hooks/useTerminalSettings.ts', 'utf8')
const settingsCompatibility = await readFile('src/services/settings/legacySettingsClient.ts', 'utf8')
const recordingsWindow = await readFile('src/components/RecordingsWindow.tsx', 'utf8')
const recordingsCompatibility = await readFile('src/services/recordings/legacyRecordingsClient.ts', 'utf8')

test('file diff UI path uses the shared client facade, with preload isolated to compatibility adapter', () => {
  assert.match(gateway, /FileViewerClient/)
  assert.match(gateway, /fileViewerClient\.getGitDiff/)
  assert.doesNotMatch(gateway, /window\.terminay\.getGitDiff/)
  assert.match(compatibility, /window\.terminay\.getGitDiff/)
  assert.match(compatibility, /Compatibility-only adapter/)
})

test('performant text viewer uses shared ranged text queries, with preload isolated to compatibility adapter', () => {
  assert.match(performantTextViewer, /createLegacyFileViewerClient/)
  assert.match(performantTextViewer, /\.getTextMetadata\(/)
  assert.match(performantTextViewer, /\.readTextLines\(/)
  assert.doesNotMatch(performantTextViewer, /window\.terminay\.getFileTextMetadata/)
  assert.doesNotMatch(performantTextViewer, /window\.terminay\.readFileTextLines/)
  assert.match(compatibility, /file\.text-metadata/)
  assert.match(compatibility, /file\.text-lines/)
  assert.match(compatibility, /window\.terminay\.getFileTextMetadata/)
  assert.match(compatibility, /window\.terminay\.readFileTextLines/)
})

test('terminal settings hook uses SettingsClient, with preload isolated to compatibility adapter', () => {
  assert.match(settingsHook, /createLegacySettingsClient/)
  assert.match(settingsHook, /settingsClient\.(get|onChanged)/)
  assert.doesNotMatch(settingsHook, /window\.terminay\.getTerminalSettings/)
  assert.doesNotMatch(settingsHook, /window\.terminay\.onTerminalSettingsChanged/)
  assert.match(settingsCompatibility, /new SettingsClient/)
  assert.match(settingsCompatibility, /SETTINGS_(OPERATIONS|EVENTS)/)
  assert.match(settingsCompatibility, /window\.terminay/)
})

test('file panel uses shared file/settings clients, with preload isolated to adapters', () => {
  assert.match(filePanel, /createLegacyFileViewerClient/)
  assert.match(filePanel, /\.getTextMetadata\(/)
  assert.match(filePanel, /\.readTextLines\(/)
  assert.match(filePanel, /\.saveSparseFile\(/)
  assert.match(filePanel, /createLegacySettingsClient/)
  assert.match(filePanel, /settingsClient\.update\(/)
  assert.doesNotMatch(filePanel, /window\.terminay\./)
  assert.match(compatibility, /file\.save-sparse/)
  assert.match(settingsCompatibility, /SETTINGS_OPERATIONS\.update/)
})

test('recordings timeline uses the shared client facade, with preload isolated to compatibility adapter', () => {
  assert.match(recordingsWindow, /createLegacyRecordingsClient/)
  assert.match(recordingsWindow, /recordingsClient\.(list|replay|delete|reveal)/)
  assert.doesNotMatch(recordingsWindow, /window\.terminay\.listTerminalRecordings/)
  assert.doesNotMatch(recordingsWindow, /window\.terminay\.readTerminalRecordingChunk/)
  assert.doesNotMatch(recordingsWindow, /window\.terminay\.deleteTerminalRecordingById/)
  assert.doesNotMatch(recordingsWindow, /window\.terminay\.revealTerminalRecordingById/)
  assert.match(recordingsCompatibility, /new TerminayClientFacade/)
  assert.match(recordingsCompatibility, /recordings\.(list|replay|delete|reveal)/)
  assert.match(recordingsCompatibility, /window\.terminay/)
})
