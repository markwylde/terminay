import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [app, preload, declarations] = await Promise.all([
  readFile('src/App.tsx', 'utf8'),
  readFile('electron/preload.ts', 'utf8'),
  readFile('src/vite-env.d.ts', 'utf8'),
])

test('Git worktree panel state has no legacy Desktop renderer host', () => {
  assert.doesNotMatch(app, /window\.terminayGitWorktreeHost/u)
  assert.doesNotMatch(app, /window\.terminay\.(?:getFileExplorerGitStatuses|getWorktreePanelStatus|moveGitWorktree|removeGitWorktree|pullGitWorktreeFromOrigin)/u)
  assert.doesNotMatch(preload, /exposeInMainWorld\(\s*'terminayGitWorktreeHost'/u)
  assert.doesNotMatch(preload, /DESKTOP_GIT_WORKTREE_HOST_BRIDGE_VERSION/u)
  assert.doesNotMatch(preload, /gitWorktreeHostPath/u)
  assert.doesNotMatch(declarations, /terminayGitWorktreeHost\?:/u)
})
