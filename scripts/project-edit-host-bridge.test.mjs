import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [app, projectEditor, auxiliaryRoutes, preload, main, declarations, api] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/workspace/useProjectEditor.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/shared/auxiliaryRoutes.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8'),
  readFile(new URL('../electron/main.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/vite-env.d.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/types/terminay.ts', import.meta.url), 'utf8'),
])

test('project editing uses only the narrow native project-edit host', () => {
  assert.match(projectEditor, /auxiliaryRoutes\.editProjectTab\(/u)
  assert.match(auxiliaryRoutes, /getWindow\(\)\?\.terminayProjectEditHost/u)
  assert.match(auxiliaryRoutes, /host\.open\(\{ \.\.\.state\.draft, projectId: state\.projectId \}\)/u)
  assert.doesNotMatch(projectEditor, /window\.terminayProjectEditHost\?\.open\(/u)
  assert.doesNotMatch(app, /window\.terminay\.openProjectEditWindow\(/u)
  assert.match(declarations, /terminayProjectEditHost\?:/u)
})

test('Electron validates the exact versioned project-edit request before opening a window', () => {
  assert.match(preload, /exposeInMainWorld\(\s*'terminayProjectEditHost'/u)
  assert.match(preload, /desktop:project-edit-host:open/u)
  assert.match(preload, /DESKTOP_PROJECT_EDIT_HOST_BRIDGE_VERSION = 1/u)
  assert.match(main, /ipcMain\.handle\(\s*'desktop:project-edit-host:open'/u)
  assert.match(main, /assertTrustedAppSender\(event\)/u)
  assert.match(main, /Object\.keys\(request\)\.length !== 2/u)
  assert.match(main, /request\.version !== 1/u)
  assert.match(main, /Object\.keys\(draft\)\.length !== 4/u)
})

test('the retired broad project-edit IPC and preload method cannot return', () => {
  assert.doesNotMatch(preload, /openProjectEditWindow:/u)
  assert.doesNotMatch(main, /ipcMain\.handle\('app:open-project-edit'/u)
  assert.doesNotMatch(api, /^ {2}openProjectEditWindow:/mu)
})
