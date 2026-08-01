import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [app, auxiliaryRoutes, preload, main, declarations] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/shared/auxiliaryRoutes.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8'),
  readFile(new URL('../electron/main.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8'),
])

test('workspace recordings commands use only the narrow native recordings host', () => {
  assert.match(app, /auxiliaryRoutes\.openRecordings\(\)/u)
  assert.match(auxiliaryRoutes, /getWindow\(\)\?\.terminayRecordingsHost/u)
  assert.match(auxiliaryRoutes, /host\.open\(\)/u)
  assert.doesNotMatch(app, /window\.terminayRecordingsHost\?\.open\(\)/u)
  assert.doesNotMatch(app, /window\.terminay\.openRecordingsWindow\(\)/u)
  assert.match(declarations, /terminayRecordingsHost\?:/u)
})

test('Electron validates a versioned recordings-host envelope before opening a native window', () => {
  assert.match(preload, /exposeInMainWorld\(\s*'terminayRecordingsHost'/u)
  assert.match(preload, /desktop:recordings-host:open/u)
  assert.match(preload, /DESKTOP_RECORDINGS_HOST_BRIDGE_VERSION = 1/u)
  assert.match(main, /ipcMain\.handle\('desktop:recordings-host:open'/u)
  assert.match(main, /assertTrustedAppSender\(event\)/u)
  assert.match(main, /Object\.keys\(request\)\.length !== 1/u)
  assert.match(main, /request\.version !== 1/u)
})

test('the retired broad recordings IPC and preload method cannot return', () => {
  assert.doesNotMatch(preload, /openRecordingsWindow:/u)
  assert.doesNotMatch(main, /ipcMain\.handle\('app:open-recordings'/u)
})
