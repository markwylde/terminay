import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

test('Task 19 edit-window route injects its exact two-operation host', async () => {
  const [wrapper, runtime] = await Promise.all([
    readFile('src/components/EditTabWindow.tsx', 'utf8'),
    readFile('src/rendererRuntime.tsx', 'utf8'),
  ])
  assert.match(wrapper, /client\.getEditWindowState\(\)/u)
  assert.match(wrapper, /client\.submitEditWindowResult\(request\)/u)
  assert.doesNotMatch(wrapper, /window\.terminay/u)
  assert.match(runtime, /<EditTabWindow client=\{window\.terminayEditWindowHost\} \/>/u)
  assert.doesNotMatch(runtime, /ServerEditWindowRoute|ServerWorkspaceSurface/u)
})

test('Task 19 removes the edit-window renderer-global compatibility hand-off', async () => {
  const [entry, preload, declarations] = await Promise.all([
    readFile('src/rendererApp.tsx', 'utf8'),
    readFile('electron/preload.ts', 'utf8'),
    readFile('src/vite-env.d.ts', 'utf8'),
  ])
  assert.doesNotMatch(entry, /EditWindow/u)
  assert.match(preload, /exposeInMainWorld\(\s*'terminayEditWindowHost'/u)
  assert.match(declarations, /terminayEditWindowHost:/u)
  assert.doesNotMatch(preload, /terminayEditWindowCompatibilityHost/u)
  assert.doesNotMatch(declarations, /terminayEditWindowCompatibilityHost/u)
  await assert.rejects(
    access('src/services/editTab/legacyEditWindowCapability.ts'),
    (error) => error?.code === 'ENOENT',
  )
})

test('workspace launches terminal editing through the narrow native host', async () => {
  const [app, auxiliaryRoutes, preload, declarations] = await Promise.all([
    readFile('src/App.tsx', 'utf8'),
    readFile('src/shared/auxiliaryRoutes.tsx', 'utf8'),
    readFile('electron/preload.ts', 'utf8'),
    readFile('src/vite-env.d.ts', 'utf8'),
  ])
  assert.match(app, /auxiliaryRoutes\.editTerminalTab\(/u)
  assert.match(auxiliaryRoutes, /getWindow\(\)\?\.terminayTerminalEditHost/u)
  assert.match(auxiliaryRoutes, /host\.open\(state\.draft\)/u)
  assert.doesNotMatch(app, /window\.terminayTerminalEditHost\?\.open\(/u)
  assert.doesNotMatch(app, /window\.terminay\.openTerminalEditWindow/u)
  assert.match(preload, /exposeInMainWorld\(\s*'terminayTerminalEditHost'/u)
  assert.match(preload, /DESKTOP_TERMINAL_EDIT_HOST_BRIDGE_VERSION = 1/u)
  assert.match(declarations, /terminayTerminalEditHost\?:/u)
})
