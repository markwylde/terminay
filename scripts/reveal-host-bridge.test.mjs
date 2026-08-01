import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [app, folderPanel, folderTasks, preload, main, declarations, api] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/folder-viewer/FolderPanel.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/folder-viewer/FolderTasksViewer.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8'),
  readFile(new URL('../electron/main.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/types/terminay.ts', import.meta.url), 'utf8'),
])

test('production workspace reveal actions use only the narrow native host bridge', () => {
  for (const source of [app, folderPanel, folderTasks]) {
    assert.match(source, /window\.terminayRevealHost\?\.reveal\(/u)
    assert.doesNotMatch(source, /window\.terminay\.revealInOS\(/u)
  }
  assert.match(declarations, /terminayRevealHost\?:/u)
  assert.doesNotMatch(api, /revealInOS:/u)
})

test('Electron validates a versioned reveal-host envelope before shell access', () => {
  assert.match(preload, /exposeInMainWorld\('terminayRevealHost'/u)
  assert.match(preload, /desktop:reveal-host:reveal/u)
  assert.match(preload, /DESKTOP_REVEAL_HOST_BRIDGE_VERSION = 1/u)
  assert.match(main, /ipcMain\.handle\('desktop:reveal-host:reveal'/u)
  const handler = main.slice(main.indexOf("ipcMain.handle('desktop:reveal-host:reveal'"), main.indexOf("ipcMain.handle('app:get-update-status'"))
  assert.match(handler, /assertTrustedAppSender\(event\)/u)
  assert.match(handler, /Object\.keys\(request\)\.length !== 2/u)
  assert.match(handler, /request\.version !== 1/u)
  assert.match(handler, /!path\.isAbsolute\(request\.filePath\)/u)
  assert.match(handler, /shell\.showItemInFolder\(request\.filePath\)/u)
  assert.doesNotMatch(main, /shell:reveal-in-os/u)
})
