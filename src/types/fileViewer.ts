import type {
  FileViewerFileInfo,
  FileViewerGitDiff,
  FileViewerGitRepoInfo,
  FileViewerPreviewSource,
} from './terminay'

export type FileViewerMode = 'preview' | 'text' | 'hex' | 'diff'

export type FileViewerEngine = 'auto' | 'performant' | 'monaco'

export type FileConflictState =
  | {
      kind: 'none'
    }
  | {
      kind: 'external-change'
      diskMtimeMs: number
    }

export type FileDiffLayout = 'side-by-side' | 'unified'

export type FilePreviewKind =
  | 'markdown'
  | 'image'
  | 'pdf'
  | 'text'
  | 'hex'
  | 'unsupported'

export type FileTextWindow = {
  endLine: number
  lineEndOffset: number
  lineStartOffset: number
  startLine: number
  text: string
}

export type FileReadResponse = {
  base64: string
  byteLength: number
}

export type FileSavePayload =
  | {
      kind: 'text'
      text: string
    }
  | {
      kind: 'binary'
      base64: string
    }

export type FileRangeRequest = {
  length: number
  offset: number
}

export type FileInfo = {
  exists: boolean
  extension: string
  isBinary: boolean
  isDirectory: boolean
  isFile: boolean
  isLargeFile: boolean
  isSymbolicLink: boolean
  mimeType: string | null
  mtimeMs: number | null
  name: string
  path: string
  size: number
}

export type FilePreviewCapabilities = {
  canDiff: boolean
  canEditHex: boolean
  canEditText: boolean
  canPreview: boolean
  canUseMonaco: boolean
  fallbackMode: FileViewerMode
  previewKind: FilePreviewKind
  shouldPromptForEngineChoice: boolean
}

export type FileSessionState = {
  conflict: FileConflictState
  diffLayout: FileDiffLayout
  draftMtimeMs: number | null
  engine: FileViewerEngine
  file: FileInfo
  isDirty: boolean
  mode: FileViewerMode
}

export type GitFileDiff = {
  hunks: GitFileDiffHunk[]
  isBinary: boolean
  isTracked: boolean
  path: string
  repositoryRoot: string | null
  rawPatch: string
}

export type GitFileDiffHunk = {
  header: string
  lines: GitFileDiffLine[]
}

export type GitFileDiffLine = {
  newLineNumber: number | null
  oldLineNumber: number | null
  type: 'add' | 'context' | 'delete'
  value: string
}

export type FileWatchEvent = {
  exists: boolean
  mtimeMs: number | null
  path: string
  size: number
  type: 'deleted' | 'error' | 'renamed' | 'updated'
}

export type FileViewerGateway = {
  getFileDiff: (path: string) => Promise<GitFileDiff>
  getFileInfo: (path: string) => Promise<FileInfo>
  getGitRepoInfo: (path: string) => Promise<FileViewerGitRepoInfo>
  getPreviewSource: (path: string) => Promise<FileViewerPreviewSource>
  onFileWatchEvent: (listener: (event: FileWatchEvent) => void) => () => void
  readFileBytes: (path: string, range: FileRangeRequest) => Promise<FileReadResponse>
  readFileText: (path: string) => Promise<string>
  saveFile: (path: string, payload: FileSavePayload) => Promise<FileInfo>
  unwatchFile: (path: string) => Promise<void>
  watchFile: (path: string) => Promise<void>
}

export type FilePanelParams = {
  filePath: string
  initialMode?: FileViewerMode
}

export function toFileInfo(fileInfo: FileViewerFileInfo): FileInfo {
  return {
    exists: fileInfo.exists,
    extension: fileInfo.extension,
    isBinary: false,
    isDirectory: fileInfo.isDirectory,
    isFile: fileInfo.isFile,
    isLargeFile: fileInfo.size > 100 * 1024 * 1024,
    isSymbolicLink: fileInfo.isSymbolicLink,
    mimeType: null,
    mtimeMs: fileInfo.mtimeMs,
    name: fileInfo.name,
    path: fileInfo.path,
    size: fileInfo.size,
  }
}

export function parseGitDiff(gitDiff: FileViewerGitDiff, repoInfo: FileViewerGitRepoInfo): GitFileDiff {
  const hunks: GitFileDiffHunk[] = []
  let currentHunk: GitFileDiffHunk | null = null
  let oldLineNumber = 0
  let newLineNumber = 0

  for (const line of gitDiff.patch.split(/\r?\n/)) {
    if (line.startsWith('@@')) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      oldLineNumber = match ? Number.parseInt(match[1], 10) : 0
      newLineNumber = match ? Number.parseInt(match[2], 10) : 0
      currentHunk = {
        header: line,
        lines: [],
      }
      hunks.push(currentHunk)
      continue
    }

    if (!currentHunk) {
      continue
    }

    if (line.startsWith('+')) {
      currentHunk.lines.push({
        newLineNumber,
        oldLineNumber: null,
        type: 'add',
        value: line.slice(1),
      })
      newLineNumber += 1
      continue
    }

    if (line.startsWith('-')) {
      currentHunk.lines.push({
        newLineNumber: null,
        oldLineNumber,
        type: 'delete',
        value: line.slice(1),
      })
      oldLineNumber += 1
      continue
    }

    if (line.startsWith('\\')) {
      continue
    }

    currentHunk.lines.push({
      newLineNumber,
      oldLineNumber,
      type: 'context',
      value: line.startsWith(' ') ? line.slice(1) : line,
    })
    oldLineNumber += 1
    newLineNumber += 1
  }

  return {
    hunks,
    isBinary: gitDiff.isBinary,
    isTracked: repoInfo.isTracked,
    path: gitDiff.path,
    rawPatch: gitDiff.patch,
    repositoryRoot: gitDiff.repoRoot,
  }
}
