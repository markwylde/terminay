import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('recording lifecycle and data use a frozen named host, never the broad application preload', async () => {
  const [app, recordingsWindow, preload, declarations, compatibility] = await Promise.all([
    readFile(new URL('src/App.tsx', root), 'utf8'),
    readFile(new URL('src/components/RecordingsWindow.tsx', root), 'utf8'),
    readFile(new URL('electron/preload.ts', root), 'utf8'),
    readFile(new URL('src/vite-env.d.ts', root), 'utf8'),
    readFile(new URL('src/types/terminay.ts', root), 'utf8'),
  ])

  assert.match(app, /createLegacyRecordingsClient\(\s*window\.terminayRecordingServiceHost,?\s*\)/u)
  assert.match(recordingsWindow, /createLegacyRecordingsClient\(window\.terminayRecordingServiceHost\)/u)
  assert.match(preload, /exposeInMainWorld\(\s*'terminayRecordingServiceHost',\s*Object\.freeze\(/u)
  assert.match(preload, /DESKTOP_RECORDING_SERVICE_HOST_BRIDGE_VERSION = 1/u)
  assert.match(preload, /desktop:recording-service-host:start/u)
  assert.match(preload, /desktop:recording-service-host:read-chunk/u)
  assert.match(preload, /desktop:recording-service-host:reveal/u)
  assert.doesNotMatch(preload, /terminal-recording:start/u)
  assert.doesNotMatch(preload, /terminal-recording:read-chunk/u)
  assert.doesNotMatch(preload, /terminal-recording:reveal-by-id/u)
  assert.match(declarations, /terminayRecordingServiceHost\?:/u)
  assert.doesNotMatch(compatibility, /listTerminalRecordings: \(/u)
})

test('Electron validates exact versioned recording-service host envelopes', async () => {
  const main = await readFile(new URL('electron/main.ts', root), 'utf8')

  for (const operation of ['get-state', 'start', 'stop', 'list', 'read-chunk', 'delete', 'reveal']) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\(\\s*'desktop:recording-service-host:${operation}'[\\s\\S]{0,300}assertTrustedAppSender\\(event\\)`, 'u'))
  }
  assert.match(main, /function readRecordingServiceRequest/u)
  assert.match(main, /function readOptionalRecordingServiceRequest/u)
  assert.match(main, /Object\.keys\(request\)\.length !== keys\.length/u)
  assert.match(main, /recording chunk \$\{key\} is invalid/u)
  assert.doesNotMatch(main, /ipcMain\.handle\('terminal-recording:get-state'/u)
  assert.doesNotMatch(main, /ipcMain\.handle\('terminal-recording:start'/u)
  assert.doesNotMatch(main, /ipcMain\.handle\('terminal-recording:read-chunk'/u)
})
