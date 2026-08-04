import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [app, preload, main, declarations] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8'),
  readFile(new URL('../electron/main.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8'),
])

test('workspace update polling uses only the narrow native update host', () => {
  assert.match(app, /window\.terminayUpdateHost\?\.getStatus\(force\)/u)
  assert.doesNotMatch(app, /window\.terminay\.getAppUpdateStatus\(/u)
  assert.match(declarations, /terminayUpdateHost\?:/u)
})

test('Electron validates a versioned update-host envelope before native update access', () => {
  assert.match(preload, /exposeInMainWorld\('terminayUpdateHost'/u)
  assert.match(preload, /desktop:update-host:get-status/u)
  assert.match(preload, /DESKTOP_UPDATE_HOST_BRIDGE_VERSION = 1/u)
  assert.match(main, /ipcMain\.handle\('desktop:update-host:get-status'/u)
  assert.match(main, /assertTrustedAppSender\(event\)/u)
  assert.match(main, /Object\.keys\(request\)\.length !== 2/u)
  assert.match(main, /request\.version !== 1/u)
  assert.match(main, /typeof request\.force !== 'boolean'/u)
})

test('the retired broad update IPC and preload method cannot return', () => {
  assert.doesNotMatch(preload, /getAppUpdateStatus:/u)
  assert.doesNotMatch(main, /ipcMain\.handle\('app:get-update-status'/u)
})
