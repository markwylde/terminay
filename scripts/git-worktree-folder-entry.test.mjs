import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { isDirectoryEntry } from '../src/workspace/fileExplorerEntries.ts'
import {
  gitFilesystemActionWorktreeRoot,
  rootFolderToRestoreAfter,
} from '../src/workspace/gitFilesystemScope.ts'
import { loadServerGitWorkspace } from '../src/services/git/serverGitWorkspaceAdapter.ts'

test('a worktree directory change reaches the sidebar as a directory', async () => {
  const projection = await loadServerGitWorkspace(
    gitClientWithWorktreeEntries([
      { path: 'node_modules', kind: 'untracked', isDirectory: true, staged: false, previousPath: null },
      { path: 'src/index.ts', kind: 'modified', isDirectory: false, staged: false, previousPath: null },
    ]),
    'project',
  )
  const worktree = projection.worktrees.worktrees.find(
    (candidate) => candidate.path === '/workspace/repo-feature',
  )

  assert.ok(worktree, 'expected the feature worktree in the projection')
  const linked = worktree.entries.find((entry) => entry.relativePath === 'node_modules')
  assert.equal(linked?.isDirectory, true)
  assert.equal(linked?.path, '/workspace/repo-feature/node_modules')
  const file = worktree.entries.find((entry) => entry.relativePath === 'src/index.ts')
  assert.equal(file?.isDirectory, false)
})

test('a symlinked directory lists as a folder and a symlinked file does not', () => {
  assert.equal(isDirectoryEntry({ kind: 'directory' }), true)
  assert.equal(
    isDirectoryEntry({ kind: 'symlink', targetKind: 'directory', accessible: true }),
    true,
  )
  assert.equal(
    isDirectoryEntry({ kind: 'symlink', targetKind: 'file', accessible: true }),
    false,
  )
  assert.equal(
    isDirectoryEntry({ kind: 'symlink', targetKind: 'directory', accessible: false }),
    false,
  )
  assert.equal(isDirectoryEntry({ kind: 'file' }), false)
})

test('a mutation in another worktree hands the project root back afterwards', () => {
  const worktrees = [{ path: '/workspace/repo' }, { path: '/workspace/repo-feature' }]
  const worktreeRoot = gitFilesystemActionWorktreeRoot(
    '/workspace/repo-feature/node_modules',
    '/workspace/repo',
    worktrees,
  )

  assert.equal(worktreeRoot, '/workspace/repo-feature')
  assert.equal(
    rootFolderToRestoreAfter({
      kind: 'delete',
      restoreRootFolder: '/workspace/repo',
      worktreeRoot,
    }),
    '/workspace/repo',
  )
  assert.equal(
    rootFolderToRestoreAfter({
      kind: 'rename',
      restoreRootFolder: '/workspace/repo',
      worktreeRoot,
    }),
    '/workspace/repo',
  )
  // Opening an entry is navigation into the worktree, so it stays there.
  assert.equal(
    rootFolderToRestoreAfter({
      kind: 'open-entry',
      restoreRootFolder: '/workspace/repo',
      worktreeRoot,
    }),
    null,
  )
  assert.equal(
    rootFolderToRestoreAfter({
      kind: 'delete',
      restoreRootFolder: '/workspace/repo-feature',
      worktreeRoot,
    }),
    null,
  )
})

test('the Explorer restores the borrowed root once the mutation settles', async () => {
  const source = await readFile('src/workspace/useFileExplorerController.ts', 'utf8')

  assert.match(source, /restoreRootFolder: project\.rootFolder/u)
  assert.match(source, /const restoreRootFolder = rootFolderToRestoreAfter\(action\)/u)
  assert.match(
    source,
    /void completed\.finally\(\(\) => \{\s*onUpdateProject\(project\.id, \{ rootFolder: restoreRootFolder \}\);/u,
  )
})

test('the Git panel opens and labels a directory change as a folder', async () => {
  const source = await readFile('src/components/git-panel/GitPanel.tsx', 'utf8')

  assert.match(source, /const isDirectory = entry\.isDirectory;/u)
  assert.match(
    source,
    /isDirectory \? onOpenFolder\(entry\.path\) : onOpenEntry\(entry\)/u,
  )
  assert.match(source, /onContextMenu\(event, entry\.path, entry\.relativePath, isDirectory\)/u)
  assert.match(source, /isDirectory \? <Folder size=\{14\} \/> :/u)
})

function gitClientWithWorktreeEntries(entries) {
  return {
    async list(request) {
      assert.equal(request.projectId, 'project')
      return {
        state: 'ready',
        repositoryRoot: '/workspace/repo',
        defaultBranch: 'main',
        worktrees: [
          {
            path: '/workspace/repo',
            id: 'worktree-main',
            repositoryId: 'repository-1',
            name: 'repo',
            branch: 'main',
            head: 'a'.repeat(40),
            detached: false,
            locked: false,
            isBare: false,
            isMain: true,
            isPrunable: false,
            state: 'clean',
            aheadOfDefaultBranchCount: 0,
            lineAdditions: 0,
            lineDeletions: 0,
            hasCommittedChanges: false,
            entries: [],
          },
          {
            path: '/workspace/repo-feature',
            id: 'worktree-feature',
            repositoryId: 'repository-1',
            name: 'repo-feature',
            branch: 'feature',
            head: 'b'.repeat(40),
            detached: false,
            locked: false,
            isBare: false,
            isMain: false,
            isPrunable: false,
            state: 'dirty',
            aheadOfDefaultBranchCount: 1,
            lineAdditions: 1,
            lineDeletions: 0,
            hasCommittedChanges: true,
            entries,
          },
        ],
      }
    },
  }
}
