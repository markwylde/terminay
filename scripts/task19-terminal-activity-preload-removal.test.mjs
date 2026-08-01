import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Task 19 removes the unused Electron terminal-activity supplier', async () => {
  const [preload, compatibility, rendererConnection, app] = await Promise.all([
    readFile('electron/preload.ts', 'utf8'),
    readFile('src/types/terminay.ts', 'utf8'),
    readFile('src/shared/rendererAgentConnection.ts', 'utf8'),
    readFile('src/App.tsx', 'utf8'),
  ])
  assert.doesNotMatch(preload, /onTerminalActivity:|ipcRenderer\.on\('terminal:activity'/u)
  assert.doesNotMatch(compatibility, /^ {2}onTerminalActivity:/mu)
  assert.doesNotMatch(app, /window\.terminay\.onTerminalActivity/u)
  assert.match(rendererConnection, /return client\.onChange\(/u)
})
