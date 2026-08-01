import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('all production clipboard access uses only the narrow versioned native host bridge', async () => {
  const [panel, preload, main, declarations, app, gitPanel, worktreesPanel, folderPanel, tasksViewer] = await Promise.all([
    readFile(new URL('src/components/TerminalPanel.tsx', root), 'utf8'),
    readFile(new URL('electron/preload.ts', root), 'utf8'),
    readFile(new URL('electron/main.ts', root), 'utf8'),
    readFile(new URL('src/vite-env.d.ts', root), 'utf8'),
    readFile(new URL('src/App.tsx', root), 'utf8'),
    readFile(new URL('src/components/git-panel/GitPanel.tsx', root), 'utf8'),
    readFile(new URL('src/components/git-panel/WorktreesPanel.tsx', root), 'utf8'),
    readFile(new URL('src/components/folder-viewer/FolderPanel.tsx', root), 'utf8'),
    readFile(new URL('src/components/folder-viewer/FolderTasksViewer.tsx', root), 'utf8'),
  ])

  assert.match(panel, /window\.terminayClipboardHost\?\.writeText\(text\)/u)
  assert.match(panel, /window\.terminayClipboardHost\?\.readText\(\)\s*\?\?\s*Promise\.resolve\(''\)/u)
  assert.doesNotMatch(panel, /window\.terminay\.writeClipboardText\(/u)
  assert.doesNotMatch(panel, /window\.terminay\.smartPasteClipboard\(/u)

  assert.match(preload, /DESKTOP_CLIPBOARD_HOST_BRIDGE_VERSION = 1/u)
  assert.match(preload, /exposeInMainWorld\('terminayClipboardHost'/u)
  assert.match(app, /window\.terminayClipboardHost\?\.subscribeCopyRequest\(/u)
  assert.doesNotMatch(app, /window\.terminay\.onTerminalCopyRequested\(/u)
  assert.match(preload, /subscribeCopyRequest:/u)
  assert.doesNotMatch(preload, /onTerminalCopyRequested:/u)
  assert.match(preload, /desktop:clipboard-host:read/u)
  assert.match(preload, /desktop:clipboard-host:write/u)
  assert.match(preload, /text\.length > 1_048_576/u)

  assert.match(main, /ipcMain\.handle\('desktop:clipboard-host:read'/u)
  assert.match(main, /ipcMain\.handle\('desktop:clipboard-host:write'/u)
  assert.match(main, /desktop:clipboard-host:read'[\s\S]{0,480}assertTrustedAppSender\(event\)/u)
  assert.match(main, /desktop:clipboard-host:write'[\s\S]{0,640}assertTrustedAppSender\(event\)/u)
  assert.match(main, /desktop:clipboard-host:read'[\s\S]{0,760}Object\.keys\(request\)\.length !== 1/u)
  assert.match(main, /desktop:clipboard-host:write'[\s\S]{0,980}Object\.keys\(request\)\.length !== 2/u)
  assert.match(main, /desktop:clipboard-host:write'[\s\S]{0,1200}clipboard\.writeText\(request\.text\)/u)
  assert.match(declarations, /terminayClipboardHost\?:/u)
  assert.match(declarations, /subscribeCopyRequest\(/u)
  assert.doesNotMatch(preload, /clipboard:smart-paste|clipboard:write-text|smartPasteClipboard|writeClipboardText/u)
  assert.doesNotMatch(main, /ipcMain\.(?:handle|on)\('clipboard:(?:smart-paste|write-text)'/u)
  for (const source of [app, gitPanel, worktreesPanel, folderPanel, tasksViewer]) {
    assert.match(source, /window\.terminayClipboardHost\?\.writeText\(/u)
    assert.doesNotMatch(source, /window\.terminay\.writeClipboardText\(/u)
  }
})
