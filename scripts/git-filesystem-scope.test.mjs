import assert from 'node:assert/strict'
import test from 'node:test'
import { toContainedProjectRelativePath } from '../src/pathUtils.ts'
import {
  gitFilesystemActionWorktreeRoot,
  owningWorktreeForPath,
} from '../src/workspace/gitFilesystemScope.ts'

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

test('Git tree mutations switch away from the current project root', () => {
  const worktrees = [
    { path: '/workspace/repo' },
    { path: '/workspace/repo-feature' },
  ]

  assert.equal(
    gitFilesystemActionWorktreeRoot('/workspace/repo/README.md', '/workspace/repo', worktrees),
    undefined,
  )
  assert.equal(
    gitFilesystemActionWorktreeRoot(
      '/workspace/repo-feature/prototypes/overflow',
      '/workspace/repo',
      worktrees,
    ),
    '/workspace/repo-feature',
  )
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
