import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import type {
  FileExplorerGitStatuses,
  FileViewerGitDiff,
  FileViewerGitRepoInfo,
  GitChangeEntry,
  GitFileState,
  GitPanelStatus,
  GitWorktreeStatus,
  WorktreePanelStatus,
} from '../../src/types/terminay'
import { getGitWorkingDirectory } from './pathUtils'
import type { FileBufferService } from './fileBufferService'

const execFileAsync = promisify(execFile)

type GitContext = {
  gitAvailable: boolean
  isTracked: boolean
  path: string
  relativePath: string | null
  repoRoot: string | null
}

function isMissingGitError(error: unknown): boolean {
  const candidate = error as NodeJS.ErrnoException | undefined
  return candidate?.code === 'ENOENT'
}

function isNotWorkingTreeError(error: unknown): boolean {
  const candidate = error as { stderr?: unknown; message?: unknown }
  const stderr = typeof candidate.stderr === 'string' ? candidate.stderr : ''
  const message = typeof candidate.message === 'string' ? candidate.message : ''
  return `${stderr}\n${message}`.includes('is not a working tree')
}

export class GitDiffService {
  constructor(private readonly fileBufferService: FileBufferService) {}

  async getExplorerStatuses(rawPath: string): Promise<FileExplorerGitStatuses> {
    const info = await this.fileBufferService.getFileInfo(rawPath)
    const workingDirectory = getGitWorkingDirectory(info.path, info.isDirectory)

    let repoRoot: string | null = null

    try {
      const result = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: workingDirectory })
      repoRoot = result.stdout.trim() || null
    } catch (error) {
      if (isMissingGitError(error)) {
        return {
          gitAvailable: false,
          repoRoot: null,
          statuses: {},
        }
      }

      return {
        gitAvailable: true,
        repoRoot: null,
        statuses: {},
      }
    }

    if (!repoRoot) {
      return {
        gitAvailable: true,
        repoRoot: null,
        statuses: {},
      }
    }

    const { stdout } = await execFileAsync(
      'git',
      ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=no'],
      { cwd: info.path },
    )

    return {
      gitAvailable: true,
      repoRoot,
      statuses: parseExplorerStatuses(stdout, info.path),
    }
  }

  async getPanelStatus(rawPath: string): Promise<GitPanelStatus> {
    const info = await this.fileBufferService.getFileInfo(rawPath)
    const workingDirectory = getGitWorkingDirectory(info.path, info.isDirectory)

    let repoRoot: string | null = null

    try {
      const result = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: workingDirectory })
      repoRoot = result.stdout.trim() || null
    } catch (error) {
      if (isMissingGitError(error)) {
        return {
          gitAvailable: false,
          repoRoot: null,
          branch: null,
          entries: [],
        }
      }

      return {
        gitAvailable: true,
        repoRoot: null,
        branch: null,
        entries: [],
      }
    }

    if (!repoRoot) {
      return {
        gitAvailable: true,
        repoRoot: null,
        branch: null,
        entries: [],
      }
    }

    const { stdout } = await execFileAsync(
      'git',
      ['status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all', '--ignored=no'],
      { cwd: info.path },
    )

    const { branch, entries } = parsePanelEntries(stdout, repoRoot)
    const resolvedBranch = branch === null ? await this.resolveDetachedBranch(info.path) : branch

    return {
      gitAvailable: true,
      repoRoot,
      branch: resolvedBranch,
      entries,
    }
  }

  async getWorktreePanelStatus(rawPath: string): Promise<WorktreePanelStatus> {
    const info = await this.fileBufferService.getFileInfo(rawPath)
    const workingDirectory = getGitWorkingDirectory(info.path, info.isDirectory)

    let repoRoot: string | null = null

    try {
      const result = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: workingDirectory })
      repoRoot = result.stdout.trim() || null
    } catch (error) {
      if (isMissingGitError(error)) {
        return {
          gitAvailable: false,
          repoRoot: null,
          worktrees: [],
        }
      }

      return {
        gitAvailable: true,
        repoRoot: null,
        worktrees: [],
      }
    }

    if (!repoRoot) {
      return {
        gitAvailable: true,
        repoRoot: null,
        worktrees: [],
      }
    }

    const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
      cwd: workingDirectory,
    })

    const worktrees = parseWorktreeList(stdout, repoRoot)

    const withEntries = await Promise.all(
      worktrees.map(async (worktree): Promise<GitWorktreeStatus> => {
        if (worktree.isBare || worktree.isPrunable) {
          return worktree
        }

        const worktreeInfo = await this.fileBufferService.getFileInfo(worktree.path)
        if (!worktreeInfo.exists || !worktreeInfo.isDirectory) {
          return {
            ...worktree,
            isPrunable: true,
            errorMessage: 'Worktree path no longer exists.',
            entries: [],
          }
        }

        try {
          const { stdout: statusOutput } = await execFileAsync(
            'git',
            ['status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all', '--ignored=no'],
            { cwd: worktree.path },
          )
          const { branch, entries } = parsePanelEntries(statusOutput, worktree.path)
          const resolvedBranch =
            branch === null
              ? await this.resolveDetachedBranch(worktree.path)
              : branch || worktree.branch
          const aheadOfMainCount = await this.getAheadOfMainCount(worktree.path)

          return {
            ...worktree,
            aheadOfMainCount,
            branch: resolvedBranch,
            entries,
            isDirtyBranch: aheadOfMainCount !== null && aheadOfMainCount > 0,
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return {
            ...worktree,
            errorMessage: message,
            entries: [],
          }
        }
      }),
    )

    return {
      gitAvailable: true,
      repoRoot,
      worktrees: withEntries,
    }
  }

  async moveWorktree(rawRepoPath: string, rawWorktreePath: string, rawNewPath: string): Promise<void> {
    const cwd = await this.resolveGitCommandCwd(rawRepoPath)
    const worktreePath = this.fileBufferService.normalizePath(rawWorktreePath)
    const newPath = this.fileBufferService.normalizePath(rawNewPath)

    await execFileAsync('git', ['worktree', 'move', worktreePath, newPath], { cwd })
  }

  async removeWorktree(rawRepoPath: string, rawWorktreePath: string, force: boolean): Promise<void> {
    const cwd = await this.resolveGitCommandCwd(rawRepoPath)
    const worktreePath = this.fileBufferService.normalizePath(rawWorktreePath)
    const args = force
      ? ['worktree', 'remove', '--force', worktreePath]
      : ['worktree', 'remove', worktreePath]

    try {
      await execFileAsync('git', args, { cwd })
    } catch (error) {
      if (!isNotWorkingTreeError(error)) {
        throw error
      }

      await execFileAsync('git', ['worktree', 'prune'], { cwd })
    }
  }

  private async resolveGitCommandCwd(rawPath: string): Promise<string> {
    const info = await this.fileBufferService.getFileInfo(rawPath)
    return getGitWorkingDirectory(info.path, info.isDirectory)
  }

  private async resolveDetachedBranch(cwd: string): Promise<string> {
    try {
      const result = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd })
      return result.stdout.trim() || 'HEAD'
    } catch {
      return 'HEAD'
    }
  }

  private async getAheadOfMainCount(cwd: string): Promise<number | null> {
    try {
      const result = await execFileAsync('git', ['rev-list', '--count', 'main..HEAD'], { cwd })
      const count = Number.parseInt(result.stdout.trim(), 10)
      return Number.isFinite(count) ? count : null
    } catch {
      return null
    }
  }

  async getRepoInfo(rawPath: string): Promise<FileViewerGitRepoInfo> {
    const context = await this.getGitContext(rawPath)

    return {
      canDiff: context.gitAvailable && context.repoRoot !== null && context.isTracked,
      gitAvailable: context.gitAvailable,
      isTracked: context.isTracked,
      path: context.path,
      relativePath: context.relativePath,
      repoRoot: context.repoRoot,
    }
  }

  async getDiff(rawPath: string): Promise<FileViewerGitDiff> {
    const context = await this.getGitContext(rawPath)

    if (!context.gitAvailable || !context.repoRoot || !context.relativePath || !context.isTracked) {
      return {
        compareTarget: 'HEAD',
        gitAvailable: context.gitAvailable,
        hasDiff: false,
        isBinary: false,
        path: context.path,
        patch: '',
        relativePath: context.relativePath,
        repoRoot: context.repoRoot,
      }
    }

    const repoRoot = context.repoRoot
    const relativePath = context.relativePath

    const [{ stdout: patch }, { stdout: numstat }] = await Promise.all([
      execFileAsync('git', ['diff', '--no-ext-diff', '--find-renames', 'HEAD', '--', relativePath], { cwd: repoRoot }),
      execFileAsync('git', ['diff', '--numstat', 'HEAD', '--', relativePath], { cwd: repoRoot }),
    ])

    const isBinary = numstat
      .split(/\r?\n/)
      .some((line) => line.trim().length > 0 && line.startsWith('-\t-\t'))

    return {
      compareTarget: 'HEAD',
      gitAvailable: true,
      hasDiff: patch.trim().length > 0,
      isBinary,
      path: context.path,
      patch,
      relativePath,
      repoRoot,
    }
  }

  private async getGitContext(rawPath: string): Promise<GitContext> {
    const info = await this.fileBufferService.getFileInfo(rawPath)
    const workingDirectory = getGitWorkingDirectory(info.path, info.isDirectory)

    let repoRoot: string | null = null

    try {
      const result = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: workingDirectory })
      repoRoot = result.stdout.trim() || null
    } catch (error) {
      if (isMissingGitError(error)) {
        return {
          gitAvailable: false,
          isTracked: false,
          path: info.path,
          relativePath: null,
          repoRoot: null,
        }
      }

      return {
        gitAvailable: true,
        isTracked: false,
        path: info.path,
        relativePath: null,
        repoRoot: null,
      }
    }

    const relativePathResult = await execFileAsync('git', ['rev-parse', '--show-prefix'], { cwd: workingDirectory })
    const prefix = relativePathResult.stdout.trim()
    const relativePath = info.isDirectory ? prefix.replace(/\/$/, '') || '.' : `${prefix}${info.name}`
    const repoRootPath = repoRoot as string

    try {
      await execFileAsync('git', ['ls-files', '--error-unmatch', '--', relativePath], { cwd: repoRootPath })
      return {
        gitAvailable: true,
        isTracked: true,
        path: info.path,
        relativePath,
        repoRoot: repoRootPath,
      }
    } catch {
      return {
        gitAvailable: true,
        isTracked: false,
        path: info.path,
        relativePath,
        repoRoot: repoRootPath,
      }
    }
  }
}

function parseWorktreeList(output: string, currentRepoRoot: string): GitWorktreeStatus[] {
  const sections = output
    .split(/\r?\n\r?\n/)
    .map((section) => section.trim())
    .filter((section) => section.length > 0)
  const normalizedCurrentRepoRoot = path.resolve(currentRepoRoot)

  return sections.flatMap((section, sectionIndex) => {
    const lines = section.split(/\r?\n/)
    let worktreePath: string | null = null
    let branch: string | null = null
    let head: string | null = null
    let isBare = false
    let isDetached = false
    let isLocked = false
    let isPrunable = false

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        worktreePath = line.slice('worktree '.length)
      } else if (line.startsWith('HEAD ')) {
        head = line.slice('HEAD '.length).trim() || null
      } else if (line.startsWith('branch ')) {
        branch = normalizeWorktreeBranch(line.slice('branch '.length))
      } else if (line === 'bare') {
        isBare = true
      } else if (line === 'detached') {
        isDetached = true
      } else if (line.startsWith('locked')) {
        isLocked = true
      } else if (line.startsWith('prunable')) {
        isPrunable = true
      }
    }

    if (!worktreePath) {
      return []
    }

    const resolvedPath = path.resolve(worktreePath)

    return [
      {
        path: resolvedPath,
        name: path.basename(resolvedPath) || resolvedPath,
        branch,
        head,
        aheadOfMainCount: null,
        isCurrent: resolvedPath === normalizedCurrentRepoRoot,
        isDirtyBranch: false,
        isMain: sectionIndex === 0,
        isBare,
        isDetached,
        isLocked,
        isPrunable,
        entries: [],
      },
    ]
  })
}

function normalizeWorktreeBranch(refName: string): string | null {
  const trimmed = refName.trim()
  if (!trimmed) {
    return null
  }

  const headsPrefix = 'refs/heads/'
  if (trimmed.startsWith(headsPrefix)) {
    return trimmed.slice(headsPrefix.length)
  }

  return trimmed
}

function parseExplorerStatuses(output: string, rootPath: string): Record<string, 'modified' | 'new'> {
  const result: Record<string, 'modified' | 'new'> = {}
  const entries = output.split('\0').filter((entry) => entry.length > 0)

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const code = entry.slice(0, 2)
    const rawPath = entry.slice(3)
    const nextPath =
      code.startsWith('R') || code.startsWith('C')
        ? entries[++index] ?? rawPath
        : rawPath

    const status = toExplorerStatus(code)
    if (!status || nextPath.length === 0) {
      continue
    }

    const absolutePath = path.resolve(rootPath, nextPath)
    const currentStatus = result[absolutePath]
    if (currentStatus === 'modified' || currentStatus === status) {
      continue
    }

    result[absolutePath] = currentStatus === 'new' ? 'modified' : status
  }

  return result
}

function parsePanelEntries(
  output: string,
  repoRoot: string,
): { branch: string | null; entries: GitChangeEntry[] } {
  const records = output.split('\0')
  const entries: GitChangeEntry[] = []
  let branch: string | null = null

  let index = 0

  // The first record (when --branch is used) is the branch header line.
  if (records.length > 0 && records[0].startsWith('## ')) {
    branch = parseBranchHeader(records[0])
    index = 1
  }

  for (; index < records.length; index += 1) {
    const record = records[index]
    if (record.length === 0) {
      continue
    }

    const code = record.slice(0, 2)
    if (record.length < 3 || record[2] !== ' ') {
      // Malformed porcelain line; skip rather than crash.
      continue
    }

    const porcelainPath = record.slice(3)
    if (porcelainPath.length === 0) {
      continue
    }

    const indexChar = code[0]
    const workTreeChar = code[1]

    // Renames/copies emit a second NUL record holding the original path.
    let originalPorcelainPath: string | null = null
    if (indexChar === 'R' || indexChar === 'C' || workTreeChar === 'R' || workTreeChar === 'C') {
      const next = records[index + 1]
      if (next !== undefined && next.length > 0) {
        originalPorcelainPath = next
        index += 1
      }
    }

    if (code === '??') {
      entries.push(buildPanelEntry(repoRoot, porcelainPath, 'untracked', false, null))
      continue
    }

    if (isConflictCode(indexChar, workTreeChar)) {
      entries.push(buildPanelEntry(repoRoot, porcelainPath, 'conflicted', false, originalPorcelainPath))
      continue
    }

    const stagedState = mapPorcelainStateChar(indexChar)
    if (stagedState) {
      entries.push(buildPanelEntry(repoRoot, porcelainPath, stagedState, true, originalPorcelainPath))
    }

    const unstagedState = mapPorcelainStateChar(workTreeChar)
    if (unstagedState) {
      entries.push(buildPanelEntry(repoRoot, porcelainPath, unstagedState, false, originalPorcelainPath))
    }
  }

  return { branch, entries }
}

function parseBranchHeader(record: string): string | null {
  const value = record.slice(3).trim()

  if (value.startsWith('HEAD (no branch)')) {
    // Detached HEAD; signal the caller to resolve a short sha label.
    return null
  }

  const name = value.split('...')[0].split(' ')[0].split('(')[0]
  return name.length > 0 ? name : null
}

function isConflictCode(indexChar: string, workTreeChar: string): boolean {
  if (indexChar === 'U' || workTreeChar === 'U') {
    return true
  }
  if (indexChar === 'A' && workTreeChar === 'A') {
    return true
  }
  if (indexChar === 'D' && workTreeChar === 'D') {
    return true
  }
  return false
}

function mapPorcelainStateChar(char: string): GitFileState | null {
  switch (char) {
    case 'A':
      return 'added'
    case 'M':
      return 'modified'
    case 'T':
      return 'modified'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case 'U':
      return 'conflicted'
    default:
      return null
  }
}

function buildPanelEntry(
  repoRoot: string,
  porcelainPath: string,
  state: GitFileState,
  staged: boolean,
  originalPorcelainPath: string | null,
): GitChangeEntry {
  const relativePath = porcelainPath.replace(/\\/g, '/')
  const entry: GitChangeEntry = {
    path: path.resolve(repoRoot, porcelainPath),
    relativePath,
    state,
    staged,
  }

  if (originalPorcelainPath && originalPorcelainPath.length > 0) {
    entry.originalRelativePath = originalPorcelainPath.replace(/\\/g, '/')
    entry.originalPath = path.resolve(repoRoot, originalPorcelainPath)
  }

  return entry
}

function toExplorerStatus(code: string): 'modified' | 'new' | null {
  if (code === '??') {
    return 'new'
  }

  const [indexStatus, workTreeStatus] = code.split('')
  const hasModification = [indexStatus, workTreeStatus].some((value) =>
    ['M', 'T', 'D', 'R', 'C', 'U'].includes(value),
  )
  if (hasModification) {
    return 'modified'
  }

  if (indexStatus === 'A') {
    return 'new'
  }

  return null
}
