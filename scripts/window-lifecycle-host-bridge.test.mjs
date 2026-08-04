import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('closing the final project uses only the narrow window lifecycle host', async () => {
  const [app, projectCollection, preload, main, declarations, compatibility] = await Promise.all([
    readFile(new URL('src/App.tsx', root), 'utf8'),
    readFile(new URL('src/workspace/useProjectCollection.ts', root), 'utf8'),
    readFile(new URL('electron/preload.ts', root), 'utf8'),
    readFile(new URL('electron/main.ts', root), 'utf8'),
    readFile(new URL('src/vite-env.d.ts', root), 'utf8'),
    readFile(new URL('src/types/terminay.ts', root), 'utf8'),
  ])

  assert.match(projectCollection, /window\.terminayWindowLifecycleHost\?\.closeCurrent\(\)/u)
  assert.doesNotMatch(app, /window\.terminay\.closeThisWindow\(\)/u)
  assert.match(preload, /exposeInMainWorld\(\s*'terminayWindowLifecycleHost'/u)
  assert.match(preload, /desktop:window-lifecycle-host:close-current/u)
  assert.doesNotMatch(preload, /closeThisWindow:/u)
  assert.doesNotMatch(preload, /app:close-this-window/u)
  assert.match(main, /ipcMain\.handle\(\s*'desktop:window-lifecycle-host:close-current'/u)
  assert.match(main, /desktop:window-lifecycle-host:close-current'[\s\S]{0,180}assertTrustedAppSender/u)
  assert.match(main, /Object\.keys\(payload\)\.length !== 1/u)
  assert.doesNotMatch(main, /ipcMain\.on\('app:close-this-window'/u)
  assert.match(declarations, /terminayWindowLifecycleHost\?:/u)
  assert.doesNotMatch(compatibility, /closeThisWindow/u)
})
