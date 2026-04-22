import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { FileViewerGitDiff, FileViewerGitRepoInfo } from '../../src/types/termide'
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

export class GitDiffService {
  constructor(private readonly fileBufferService: FileBufferService) {}

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
    const prefix = relativePathResult.stdout
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
