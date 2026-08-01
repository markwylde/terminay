import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [app, folderPanel, preload, main, declarations, api] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/folder-viewer/FolderPanel.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8'),
  readFile(new URL('../electron/main.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/types/terminay.ts', import.meta.url), 'utf8'),
])

test('workspace bootstrap uses only the narrow file-explorer host', () => {
  assert.match(app, /window\.terminayFileExplorerHost/u)
  assert.match(app, /window\.terminayFileExplorerHost\?\.subscribeWatchEvents\(/u)
  assert.match(folderPanel, /window\.terminayFileExplorerHost\?\.subscribeWatchEvents\(/u)
  assert.match(folderPanel, /window\.terminayFileExplorerHost\?\.subscribeFolderSizeProgress\(/u)
  assert.match(folderPanel, /terminayFileExplorerHost\?\.(?:calculateFolderSize|cancelFolderSize|watchDirectory|unwatchDirectory)/u)
  assert.doesNotMatch(folderPanel, /window\.terminay\.(?:calculateFolderSize|cancelFolderSize|watchDirectory|unwatchDirectory|listDirectory)/u)
  assert.doesNotMatch(app, /window\.terminay\.onFileExplorerWatchEvent\(/u)
  assert.doesNotMatch(folderPanel, /window\.terminay\.(?:onFileExplorerWatchEvent|onFolderSizeProgress)\(/u)
  assert.doesNotMatch(app, /window\.terminay\.getHomePath\(/u)
  assert.match(declarations, /terminayFileExplorerHost\?:/u)
  assert.match(app, /terminayFileExplorerHost\?\.watchDirectory/u)
  assert.match(app, /terminayFileExplorerHost\?\.unwatchDirectory/u)
  assert.match(app, /terminayFileExplorerHost\s*\n\s*\?\.searchFiles/u)
  assert.doesNotMatch(app, /window\.terminay\.(?:watchDirectory|unwatchDirectory)/u)
  assert.doesNotMatch(app, /window\.terminay\s*\n\s*\.searchFiles/u)
})

test('Electron validates a versioned file-explorer request before returning the home path', () => {
  assert.match(preload, /exposeInMainWorld\('terminayFileExplorerHost'/u)
  assert.match(preload, /desktop:file-explorer-host:get-home-path/u)
  assert.match(preload, /DESKTOP_FILE_EXPLORER_HOST_BRIDGE_VERSION = 1/u)
  assert.match(preload, /watchDirectory: \(path: unknown\)/u)
  assert.match(preload, /unwatchDirectory: \(path: unknown\)/u)
  assert.match(preload, /calculateFolderSize: \(request: unknown\)/u)
  assert.match(preload, /cancelFolderSize: \(jobId: unknown\)/u)
  assert.match(preload, /resolveDroppedFilePath: \(file: unknown\)/u)
  assert.match(preload, /searchFiles: \(request: unknown\)/u)
  assert.match(preload, /fileExplorerHostText/u)
  assert.match(preload, /subscribeWatchEvents:/u)
  assert.match(preload, /subscribeFolderSizeProgress:/u)
  assert.doesNotMatch(preload, /onFileExplorerWatchEvent:|onFolderSizeProgress:/u)
  assert.match(main, /ipcMain\.handle\('desktop:file-explorer-host:get-home-path'/u)
  assert.match(main, /assertTrustedAppSender\(event\)/u)
  assert.match(main, /Object\.keys\(payload\)\.length !== 1/u)
  assert.match(main, /version !== 1/u)
})

test('the retired broad home-path IPC and preload method cannot return', () => {
  assert.doesNotMatch(preload, /getHomePath: \(\) => ipcRenderer\.invoke\('fs:get-home-path'/u)
  assert.doesNotMatch(main, /ipcMain\.handle\('fs:get-home-path'/u)
  assert.doesNotMatch(api, /^ {2}getHomePath:/mu)
  assert.doesNotMatch(api, /^ {2}onFileExplorerWatchEvent:|^ {2}onFolderSizeProgress:/mu)
})

test('duplicate broad recording subscription stays removed', () => {
  assert.match(declarations, /terminayRecordingServiceHost\?:/u)
  assert.match(preload, /onTerminalRecordingChanged: \(listener: unknown\)/u)
  assert.doesNotMatch(api, /^ {2}onTerminalRecordingChanged:/mu)
})
