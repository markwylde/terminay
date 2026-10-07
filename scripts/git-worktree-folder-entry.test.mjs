import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { isDirectoryEntry } from '../src/workspace/fileExplorerEntries.ts'
import { folderChanges } from '../src/workspace/folderWorktree.ts'
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

test('a linked folder reports its worktree and the changes in it, the directory change included', async () => {
  const projection = await loadServerGitWorkspace(
    gitClientWithWorktreeEntries([
      { path: 'node_modules', kind: 'untracked', isDirectory: true, staged: false, previousPath: null },
    ]),
    'project',
  )
  const changes = folderChanges(
    { kind: 'linked', worktree: { repositoryId: 'repository-1', path: '/workspace/repo-feature' } },
    '/workspace/repo',
    projection.worktrees,
  )

  assert.equal(changes.kind, 'worktree')
  assert.equal(changes.status.branch, 'feature')
  assert.equal(changes.status.repoRoot, '/workspace/repo-feature')
  assert.deepEqual(
    changes.status.entries.map((entry) => [entry.path, entry.isDirectory]),
    [['/workspace/repo-feature/node_modules', true]],
  )
  // General is the checkout at the project root, which has none of them.
  const general = folderChanges({ kind: 'general' }, '/workspace/repo', projection.worktrees)
  assert.equal(general.kind, 'worktree')
  assert.equal(general.status.branch, 'main')
  assert.deepEqual(general.status.entries, [])
})

test('a change is created, renamed, deleted, and opened without the project root moving', async () => {
  const source = await readFile('src/workspace/useFileExplorerController.ts', 'utf8')

  assert.equal(/onUpdateProject|restoreRootFolder|rootFolderToRestoreAfter/u.test(source), false)
  // Each mutation goes straight to the file client of the folder on screen.
  for (const handler of ['handleRename', 'handleDelete', 'handleNewFile', 'handleNewFolder']) {
    const body = source.match(
      new RegExp(`const ${handler} = useCallback\\([\\s\\S]*?\\n\\t\\);`, 'u'),
    )?.[0]
    assert.ok(body, `expected ${handler}`)
    assert.match(body, /await (?:renameEntryAtPath|deleteEntryAtPath|createFileAtPath|createDirectoryAtPath)\(/u)
  }
  const open = source.match(/const handleOpenGitEntry = useCallback\([\s\S]*?\n\t\);/u)?.[0] ?? ''
  assert.match(open, /void onOpenFile\(\s*entry\.path,/u)
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
