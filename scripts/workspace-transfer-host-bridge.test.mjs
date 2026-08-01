import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('workspace transfers use only the frozen narrow host', async () => {
  const [app, transfer, preload, main, declarations, compatibility] = await Promise.all([
    readFile(new URL('src/App.tsx', root), 'utf8'),
    readFile(new URL('src/workspace/useProjectTabTransfer.ts', root), 'utf8'),
    readFile(new URL('electron/preload.ts', root), 'utf8'),
    readFile(new URL('electron/main.ts', root), 'utf8'),
    readFile(new URL('src/vite-env.d.ts', root), 'utf8'),
    readFile(new URL('src/types/terminay.ts', root), 'utf8'),
  ])

  assert.match(transfer, /window\.terminayWorkspaceTransferHost\s*\?\.getAdoptedProject\(\)/u)
  assert.match(transfer, /window\.terminayWorkspaceTransferHost\?\.subscribeAdoptedProject\(/u)
  assert.match(transfer, /window\.terminayWorkspaceTransferHost\?\.popoutProject\(/u)
  assert.match(transfer, /window\.terminayWorkspaceTransferHost\?\.mergeProject\(/u)
  assert.doesNotMatch(app, /window\.terminay\.(?:onAdoptProject|getAdoptedProject|popoutProject|mergeProject)\(/u)
  assert.match(preload, /exposeInMainWorld\('terminayWorkspaceTransferHost'/u)
  assert.match(preload, /DESKTOP_WORKSPACE_TRANSFER_HOST_BRIDGE_VERSION = 1/u)
  for (const channel of ['get-adopted-project', 'popout-project', 'merge-project']) {
    assert.match(preload, new RegExp(`desktop:workspace-transfer-host:${channel}`, 'u'))
    assert.match(main, new RegExp(`ipcMain\\.handle\\('desktop:workspace-transfer-host:${channel}'`, 'u'))
  }
  assert.match(main, /function isWorkspaceTransferPayload/u)
  assert.match(main, /Object\.keys\(payload\)\.length !== 4/u)
  assert.match(main, /Object\.keys\(payload\)\.length !== 3/u)
  const broadPreload = preload.slice(
    preload.indexOf("contextBridge.exposeInMainWorld('terminay',"),
    preload.indexOf("contextBridge.exposeInMainWorld('terminayFileExplorerHost'"),
  )
  assert.doesNotMatch(broadPreload, /getAdoptedProject:/u)
  assert.doesNotMatch(broadPreload, /onAdoptProject:/u)
  assert.doesNotMatch(broadPreload, /popoutProject:/u)
  assert.doesNotMatch(broadPreload, /mergeProject:/u)
  assert.doesNotMatch(main, /app:get-adopted-project/u)
  assert.doesNotMatch(main, /app:popout-project/u)
  assert.doesNotMatch(main, /app:merge-project/u)
  assert.match(declarations, /terminayWorkspaceTransferHost\?:/u)
  assert.match(declarations, /subscribeAdoptedProject\(/u)
  assert.doesNotMatch(compatibility, /onAdoptProject:/u)
  assert.doesNotMatch(compatibility, /getAdoptedProject:/u)
  assert.doesNotMatch(compatibility, /popoutProject:/u)
  assert.doesNotMatch(compatibility, /mergeProject:/u)
})
