import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { toContainedProjectRelativePath } from '../src/pathUtils.ts'
import { owningWorktreeForPath } from '../src/workspace/gitFilesystemScope.ts'

test('owning worktree uses the longest containing root', () => {
  const worktrees = [
    { path: '/workspace/repo' },
    { path: '/workspace/repo-feature' },
  ]

  assert.equal(
    owningWorktreeForPath('/workspace/repo/src/index.ts', worktrees)?.path,
    '/workspace/repo',
  )
  assert.equal(
    owningWorktreeForPath('/workspace/repo-feature/prototypes/overflow', worktrees)?.path,
    '/workspace/repo-feature',
  )
  assert.equal(owningWorktreeForPath('/tmp/unrelated', worktrees), undefined)
})

test('no file or Git operation changes the project root to reach a worktree', async () => {
  const [scope, controller, app] = await Promise.all([
    readFile('src/workspace/gitFilesystemScope.ts', 'utf8'),
    readFile('src/workspace/useFileExplorerController.ts', 'utf8'),
    readFile('src/App.tsx', 'utf8'),
  ])

  // A folder's root is resolved by the server from the folder id, so nothing
  // borrows another worktree's root and nothing hands one back.
  assert.doesNotMatch(scope, /gitFilesystemActionWorktreeRoot|rootFolderToRestoreAfter/u)
  assert.equal(/onUpdateProject/u.test(controller), false)
  assert.equal(
    /SwitchProjectRoot|queueOwningWorktreeAction|restoreRootFolder/u.test(controller),
    false,
  )
  assert.equal(
    /Switch project root|SwitchProjectRoot|pendingGitFolderOpen/u.test(app),
    false,
  )

  // The project root is written only where the user sets it on purpose: the
  // command that makes the active terminal's directory the root.
  const rootWrites = [...app.matchAll(/onUpdateProject\([^)]*\{\s*rootFolder:/gu)]
  assert.equal(rootWrites.length, 1)
  const setRootCommand = app.indexOf(
    'const setProjectRootFolderToWorkingDirectory = useCallback',
  )
  assert.ok(setRootCommand > 0)
  const leadUp = app.slice(setRootCommand, rootWrites[0].index)
  assert.ok(rootWrites[0].index > setRootCommand)
  // Still inside that one callback: no other one starts in between.
  assert.equal(leadUp.split('= useCallback(').length, 2)
})

test('Explorer selectors refuse sibling-worktree traversal paths', () => {
  assert.equal(
    toContainedProjectRelativePath('/workspace/repo-feature/prototypes', '/workspace/repo'),
    null,
  )
  assert.equal(
    toContainedProjectRelativePath('/workspace/repo/prototypes/overflow', '/workspace/repo'),
    'prototypes/overflow',
  )
})
