import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('the unused Git panel status IPC is not retained on the broad preload surface', async () => {
  const [preload, main, declarations] = await Promise.all([
    readFile(new URL('electron/preload.ts', root), 'utf8'),
    readFile(new URL('electron/main.ts', root), 'utf8'),
    readFile(new URL('src/types/terminay.ts', root), 'utf8'),
  ])

  assert.doesNotMatch(preload, /getGitPanelStatus:/u)
  assert.doesNotMatch(preload, /fs:get-git-panel-status/u)
  assert.doesNotMatch(main, /fs:get-git-panel-status/u)
  assert.doesNotMatch(declarations, /getGitPanelStatus:/u)
})
