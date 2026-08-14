import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const gateway = await readFile('src/services/fileViewer/serverFileGateway.ts', 'utf8')
const performantTextViewer = await readFile('src/components/file-viewer/modes/PerformantTextViewer.tsx', 'utf8')
const filePanel = await readFile('src/components/file-viewer/FilePanel.tsx', 'utf8')
const settingsHook = await readFile('src/hooks/useTerminalSettings.ts', 'utf8')
const recordingsWindow = await readFile('src/components/RecordingsWindow.tsx', 'utf8')
const app = await readFile('src/App.tsx', 'utf8')
const recordingController = await readFile('src/workspace/useTerminalRecordingController.ts', 'utf8')

test('file diff UI path uses only the canonical selected-server client', () => {
  assert.match(gateway, /FileViewerClient/)
  assert.match(gateway, /options\.client\.getGitDiff/)
  assert.doesNotMatch(gateway, /window\.terminay\.getGitDiff/)
	assert.doesNotMatch(gateway, /compatibilityGateway|legacyFileViewerTransport/)
})

test('performant text viewer uses shared ranged text queries', () => {
  assert.match(performantTextViewer, /fileViewerClient: FileViewerClient/)
	assert.match(performantTextViewer, /\.getServerTextMetadata\(/)
	assert.match(performantTextViewer, /\.readServerTextLines\(/)
  assert.doesNotMatch(performantTextViewer, /window\.terminay\.getFileTextMetadata/)
  assert.doesNotMatch(performantTextViewer, /window\.terminay\.readFileTextLines/)
})

test('terminal settings hook uses the selected server SettingsClient', () => {
  assert.match(settingsHook, /useContext\(TerminalSettingsClientContext\)/)
  assert.doesNotMatch(settingsHook, /createLegacySettingsClient|getLegacySettingsCapability/)
  assert.match(settingsHook, /settingsClient\.(get|onChanged)/)
  assert.doesNotMatch(settingsHook, /window\.terminay\.getTerminalSettings/)
  assert.doesNotMatch(settingsHook, /window\.terminay\.onTerminalSettingsChanged/)
})

test('file panel uses selected-server file/settings clients and no compatibility adapter', () => {
	assert.match(filePanel, /terminalClientContext\.fileViewerClient/)
	assert.match(filePanel, /\.getServerTextMetadata\(/)
	assert.match(filePanel, /\.readServerTextLines\(/)
  assert.match(filePanel, /\.saveSparseFile\(/)
  assert.match(filePanel, /useTerminalSettings\(\)/)
  assert.match(filePanel, /settingsClient\.update\(/)
  assert.doesNotMatch(filePanel, /window\.terminay\./)
	assert.doesNotMatch(filePanel, /DisconnectedFileCompatibility|disconnectedFilePanelCompatibility/)
})

test('recordings timeline requires the selected server shared client with no compatibility adapter', () => {
  assert.match(recordingsWindow, /readonly client: RecordingsClient/)
  assert.match(recordingsWindow, /client\.(list|replay|delete|reveal)/)
  assert.doesNotMatch(recordingsWindow, /createLegacyRecordingsClient|terminayRecordingServiceHost/)
  assert.doesNotMatch(recordingsWindow, /window\.terminay\.listTerminalRecordings/)
  assert.doesNotMatch(recordingsWindow, /window\.terminay\.readTerminalRecordingChunk/)
  assert.doesNotMatch(recordingsWindow, /window\.terminay\.deleteTerminalRecordingById/)
  assert.doesNotMatch(recordingsWindow, /window\.terminay\.revealTerminalRecordingById/)
})

test('App recording lifecycle injects only the selected server client into its feature controller', () => {
  assert.match(app, /useTerminalRecordingController\(\{/)
  assert.match(recordingController, /requireRecordingClient\(serverClient\)/)
  assert.match(recordingController, /client\.start/)
  assert.match(recordingController, /client\.stop/)
  assert.match(recordingController, /\.reveal\(recordingId\)/)
  assert.doesNotMatch(recordingController, /legacyClient|onStateChanged|getState/)
  assert.doesNotMatch(app, /window\.terminay\.startTerminalRecording/)
  assert.doesNotMatch(app, /window\.terminay\.stopTerminalRecording/)
  assert.doesNotMatch(app, /window\.terminay\.getTerminalRecordingState/)
  assert.doesNotMatch(app, /window\.terminay\.revealTerminalRecordingById/)
  assert.doesNotMatch(app, /window\.terminay\.onTerminalRecordingChanged/)
})
