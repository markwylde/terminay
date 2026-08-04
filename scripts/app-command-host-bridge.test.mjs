import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('native commands use the narrow frozen command host and reject malformed events', async () => {
  const [app, preload, declarations, compatibility] = await Promise.all([
    readFile(new URL('src/App.tsx', root), 'utf8'),
    readFile(new URL('electron/preload.ts', root), 'utf8'),
    readFile(new URL('src/vite-env.d.ts', root), 'utf8'),
    readFile(new URL('src/types/terminay.ts', root), 'utf8'),
  ])
  const broadPreload = preload.slice(
    preload.indexOf("contextBridge.exposeInMainWorld('terminay',"),
    preload.indexOf("contextBridge.exposeInMainWorld('terminayFileExplorerHost'"),
  )

  assert.match(app, /window\.terminayAppCommandHost\?\.subscribe\(/u)
  assert.doesNotMatch(app, /window\.terminay\.onAppCommand\(/u)
  assert.match(preload, /exposeInMainWorld\('terminayAppCommandHost'/u)
  assert.match(preload, /DESKTOP_APP_COMMAND_HOST_BRIDGE_VERSION = 1/u)
  assert.match(preload, /function isAppCommand/u)
  assert.match(preload, /if \(!isAppCommand\(command\)\) return/u)
  assert.doesNotMatch(broadPreload, /onAppCommand:/u)
  assert.match(declarations, /terminayAppCommandHost\?:/u)
  assert.doesNotMatch(compatibility, /onAppCommand:/u)
})
