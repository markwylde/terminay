import type {
  FileViewerFileInfo,
  FileViewerGitDiff,
  FileViewerGitRepoInfo,
  FileViewerPreviewSource,
} from './terminay'

export type FileViewerMode = 'preview' | 'tasks' | 'text' | 'hex' | 'diff'

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
  ino: number | null
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
  canTasks: boolean
  canUseMonaco: boolean
  defaultMode: FileViewerMode
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
  tooLarge: boolean
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
  readFileTextWindow: (path: string, range: FileRangeRequest) => Promise<FileTextWindow>
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
    ino: fileInfo.ino,
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

export function toGitFileDiff(gitDiff: FileViewerGitDiff): GitFileDiff {
  return {
    hunks: gitDiff.hunks,
    isBinary: gitDiff.isBinary,
    isTracked: gitDiff.isTracked,
    path: gitDiff.path,
    repositoryRoot: gitDiff.repoRoot,
    tooLarge: gitDiff.tooLarge,
  }
}
