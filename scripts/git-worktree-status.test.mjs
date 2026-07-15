import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { build } from 'esbuild'

const execFileAsync = promisify(execFile)

test('worktree status treats squash-merged commits as clean', async () => {
  const { GitDiffService } = await importBundled('../electron/fileViewer/gitDiffService.ts')
  const root = await mkdtemp(join(tmpdir(), 'terminay-git-worktree-status-test-'))
  const main = join(root, 'project')
  const feature = join(root, 'project-feature')

  try {
    await mkdir(main)
    await git(['init', '-b', 'main'], main)
    await git(['config', 'user.email', 'test@example.invalid'], main)
    await git(['config', 'user.name', 'Terminay Test'], main)
    await writeFile(join(main, 'shared.txt'), 'base\n')
    await git(['add', 'shared.txt'], main)
    await git(['commit', '-m', 'initial commit'], main)
    await git(['worktree', 'add', feature, '-b', 'feature/squash-merged'], main)

    await writeFile(join(feature, 'shared.txt'), 'base\nmerged change\n')
    await git(['add', 'shared.txt'], feature)
    await git(['commit', '-m', 'feature change'], feature)
    await writeFile(join(feature, 'squashed-too.txt'), 'second feature commit\n')
    await git(['add', 'squashed-too.txt'], feature)
    await git(['commit', '-m', 'second feature change'], feature)

    // Reproduce a squash merge: main gets the same tree change in a new commit,
    // while the feature's original commit remains outside main's history.
    await writeFile(join(main, 'shared.txt'), 'base\nmerged change\n')
    await writeFile(join(main, 'squashed-too.txt'), 'second feature commit\n')
    await writeFile(join(main, 'main-only.txt'), 'later main work\n')
    await git(['add', 'shared.txt', 'squashed-too.txt', 'main-only.txt'], main)
    await git(['commit', '-m', 'squash feature and continue on main'], main)

    const service = new GitDiffService(fileBufferStub)
    const squashMergedStatus = await service.getWorktreePanelStatus(main)
    const squashMergedWorktree = findWorktree(squashMergedStatus, feature)

    assert.equal(squashMergedWorktree.aheadOfMainCount, 2)
    assert.equal(squashMergedWorktree.isDirtyBranch, false)
    assert.equal(squashMergedWorktree.lineAdditions, 0)
    assert.equal(squashMergedWorktree.lineDeletions, 0)
    assert.deepEqual(squashMergedWorktree.entries, [])

    await writeFile(join(feature, 'shared.txt'), 'base\n')
    const uncommittedStatus = await service.getWorktreePanelStatus(main)
    const uncommittedWorktree = findWorktree(uncommittedStatus, feature)

    assert.equal(uncommittedWorktree.isDirtyBranch, false)
    assert.equal(uncommittedWorktree.lineAdditions, 0)
    assert.equal(uncommittedWorktree.lineDeletions, 1)
    assert.equal(uncommittedWorktree.entries.length, 1)

    await git(['restore', 'shared.txt'], feature)
    await writeFile(join(feature, 'feature-only.txt'), 'new\nwork\n')
    await git(['add', 'feature-only.txt'], feature)
    await git(['commit', '-m', 'new unmerged work'], feature)

    const unmergedStatus = await service.getWorktreePanelStatus(main)
    const unmergedWorktree = findWorktree(unmergedStatus, feature)

    assert.equal(unmergedWorktree.aheadOfMainCount, 3)
    assert.equal(unmergedWorktree.isDirtyBranch, true)
    assert.equal(unmergedWorktree.lineAdditions, 2)
    assert.equal(unmergedWorktree.lineDeletions, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('pulling a worktree from origin fast-forwards its current branch', async () => {
  const { GitDiffService } = await importBundled('../electron/fileViewer/gitDiffService.ts')
  const root = await mkdtemp(join(tmpdir(), 'terminay-git-worktree-pull-test-'))
  const remote = join(root, 'remote.git')
  const project = join(root, 'project')
  const contributor = join(root, 'contributor')

  try {
    await git(['init', '--bare', remote], root)
    await mkdir(project)
    await git(['init', '-b', 'main'], project)
    await git(['config', 'user.email', 'test@example.invalid'], project)
    await git(['config', 'user.name', 'Terminay Test'], project)
    await writeFile(join(project, 'shared.txt'), 'base\n')
    await git(['add', 'shared.txt'], project)
    await git(['commit', '-m', 'initial commit'], project)
    await git(['remote', 'add', 'origin', remote], project)
    await git(['push', '-u', 'origin', 'main'], project)
    await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], remote)

    await git(['clone', remote, contributor], root)
    await git(['config', 'user.email', 'contributor@example.invalid'], contributor)
    await git(['config', 'user.name', 'Contributor'], contributor)
    await writeFile(join(contributor, 'shared.txt'), 'updated upstream\n')
    await git(['add', 'shared.txt'], contributor)
    await git(['commit', '-m', 'upstream change'], contributor)
    await git(['push', 'origin', 'main'], contributor)

    const service = new GitDiffService(fileBufferStub)
    await service.pullWorktreeFromOrigin(project)

    assert.equal(await readFile(join(project, 'shared.txt'), 'utf8'), 'updated upstream\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

const fileBufferStub = {
  async getFileInfo(rawPath) {
    const normalizedPath = resolve(rawPath)
    try {
      const stats = await lstat(normalizedPath)
      return {
        exists: true,
        isDirectory: stats.isDirectory(),
        mtimeMs: stats.mtimeMs,
        name: basename(normalizedPath),
        path: normalizedPath,
      }
    } catch {
      return {
        exists: false,
        isDirectory: false,
        mtimeMs: 0,
        name: basename(normalizedPath),
        path: normalizedPath,
      }
    }
  },
  normalizePath(rawPath) {
    return resolve(rawPath)
  },
}

function findWorktree(status, worktreePath) {
  const expectedName = basename(worktreePath)
  const worktree = status.worktrees.find((candidate) => candidate.name === expectedName)
  assert.ok(worktree, `expected status for worktree ${worktreePath}`)
  return worktree
}

async function git(args, cwd) {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout
}

async function importBundled(relativePath) {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-git-worktree-status-bundle-'))
  const outputPath = join(tempDir, 'git-worktree-status.mjs')
  try {
    await build({
      entryPoints: [new URL(relativePath, import.meta.url).pathname],
      outfile: outputPath,
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node20',
    })
    return await import(outputPath)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}
