import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('the project tab bar publishes geometry only through the narrow host', async () => {
  const [app, transfer, preload, main, declarations, compatibility] = await Promise.all([
    readFile(new URL('src/App.tsx', root), 'utf8'),
    readFile(new URL('src/workspace/useProjectTabTransfer.ts', root), 'utf8'),
    readFile(new URL('electron/preload.ts', root), 'utf8'),
    readFile(new URL('electron/main.ts', root), 'utf8'),
    readFile(new URL('src/vite-env.d.ts', root), 'utf8'),
    readFile(new URL('src/types/terminay.ts', root), 'utf8'),
  ])

  assert.match(transfer, /window\.terminayProjectTabHost\?\.publishBarRect\(/u)
  assert.match(transfer, /window\.terminayProjectTabHost\?\.subscribeDragHover\(/u)
  assert.match(transfer, /window\.terminayProjectTabHost\?\.subscribeTornOff\(/u)
  assert.doesNotMatch(app, /window\.terminay\.(?:onProjectTabDragHover|onProjectTabTornOff)\(/u)
  assert.doesNotMatch(app, /window\.terminay\.registerProjectTabBarRect\(/u)
  assert.match(
    preload,
    /contextBridge\.exposeInMainWorld\(\s*'terminayProjectTabHost',\s*Object\.freeze\(\{/u,
  )
  assert.match(preload, /desktop:project-tab-host:publish-bar-rect/u)
  assert.match(preload, /desktop:project-tab-host:start-drag/u)
  assert.match(preload, /desktop:project-tab-host:end-drag/u)
  assert.match(preload, /DESKTOP_PROJECT_TAB_HOST_BRIDGE_VERSION = 1/u)
  assert.match(preload, /subscribeDragHover:/u)
  assert.match(preload, /subscribeTornOff:/u)
  assert.doesNotMatch(preload, /registerProjectTabBarRect:/u)
  assert.doesNotMatch(preload, /app:register-tabbar-rect/u)
  assert.doesNotMatch(preload, /beginProjectTabDrag:/u)
  assert.doesNotMatch(preload, /endProjectTabDrag:/u)
  assert.match(
    main,
    /ipcMain\.handle\(\s*'desktop:project-tab-host:publish-bar-rect'/u,
  )
  assert.match(
    main,
    /desktop:project-tab-host:publish-bar-rect'[\s\S]{0,240}assertTrustedAppSender/u,
  )
  assert.match(main, /Object\.keys\(payload\)\.length !== 2/u)
  assert.match(main, /Object\.keys\(rect\)\.length !== 4/u)
  assert.doesNotMatch(main, /app:register-tabbar-rect/u)
  assert.doesNotMatch(main, /app:project-drag-start/u)
  assert.doesNotMatch(main, /app:project-drag-end/u)
  assert.match(declarations, /terminayProjectTabHost\?:/u)
  assert.match(declarations, /subscribeDragHover\(/u)
  assert.match(declarations, /subscribeTornOff\(/u)
  assert.doesNotMatch(compatibility, /onProjectTabDragHover:/u)
  assert.doesNotMatch(compatibility, /onProjectTabTornOff:/u)
  assert.doesNotMatch(compatibility, /registerProjectTabBarRect/u)
  assert.doesNotMatch(compatibility, /beginProjectTabDrag/u)
  assert.doesNotMatch(compatibility, /endProjectTabDrag/u)
})
