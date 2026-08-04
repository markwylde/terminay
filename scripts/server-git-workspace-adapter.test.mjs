import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'terminay-git-adapter-'))
const outputFile = path.join(outputDirectory, 'adapter.mjs')
await execFileAsync(
  path.resolve('node_modules/.bin/esbuild'),
  [
    'src/services/git/serverGitWorkspaceAdapter.ts',
    '--bundle',
    '--format=esm',
    '--platform=node',
    `--outfile=${outputFile}`,
  ],
)
const { loadServerGitWorkspace } = await import(outputFile)

test.after(async () => {
  await rm(outputDirectory, { force: true, recursive: true })
})

test('canonical Git list maps opaque references and presentation state', async () => {
  const client = {
    async list(request) {
      assert.deepEqual(request, { projectId: 'project-a' })
      return {
        projectId: 'project-a',
        repositoryId: 'repo-a',
        repositoryRoot: '/repo',
        defaultBranch: 'main',
        state: 'ready',
        bounded: false,
        worktrees: [{
          id: 'worktree-a',
          repositoryId: 'repo-a',
          path: '/repo/feature',
          branch: 'feature',
          detached: false,
          head: 'abc',
          isMain: false,
          isBare: false,
          isPrunable: false,
          locked: false,
          state: 'dirty',
          aheadOfDefaultBranchCount: 2,
          lineAdditions: 4,
          lineDeletions: 1,
          hasCommittedChanges: true,
          entries: [{
            path: 'src/new.ts',
            previousPath: null,
            indexStatus: '?',
            worktreeStatus: '?',
            kind: 'untracked',
            staged: false,
            unstaged: true,
            unmerged: false,
          }],
        }],
      }
    },
  }

  const projection = await loadServerGitWorkspace(client, 'project-a')
  assert.deepEqual(projection.referencesByPath.get('/repo/feature'), {
    projectId: 'project-a',
    repositoryId: 'repo-a',
    worktreeId: 'worktree-a',
  })
  assert.equal(projection.statuses['/repo/feature/src/new.ts'], 'new')
  assert.equal(projection.worktrees.worktrees[0].isDirtyBranch, true)
  assert.equal(projection.worktrees.worktrees[0].aheadOfMainCount, 2)
  assert.equal(projection.worktrees.worktrees[0].lineAdditions, 4)
  assert.equal(projection.worktrees.worktrees[0].lineDeletions, 1)
  assert.equal(projection.worktrees.worktrees[0].entries[0].state, 'untracked')
})

test('malformed canonical Git list is rejected before reaching UI state', async () => {
  await assert.rejects(
    () => loadServerGitWorkspace({ list: async () => ({ state: 'ready', worktrees: [{}] }) }, 'project-a'),
    /repository root is invalid/,
  )
})
