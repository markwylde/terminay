import { FileViewerClient, type QueryCommandTransport } from '@terminay/client-core'
import type {
  FileInfo,
  FileRangeRequest,
  FileReadResponse,
  FileSavePayload,
  FileTextWindow,
  FileWatchEvent,
  GitFileDiff,
  FileViewerGateway,
} from '../../types/fileViewer'
import type {
  FileExplorerEntry,
  FileViewerByteRange,
  FileViewerFileInfo,
  FileViewerGitDiff,
  FileViewerGitRepoInfo,
  FileViewerPreviewSource,
  FileViewerSaveRequest,
  FileViewerSaveResult,
  FileViewerSparseFileSaveRequest,
  FileViewerTextEncoding,
  FileViewerTextMetadata,
  FileViewerTextRange,
  FileViewerTextWindow,
  FileViewerWatchEvent,
} from '../../types/terminay'
import { toFileInfo, toGitFileDiff } from '../../types/fileViewer'
import { createLegacyFileViewerTransport } from './legacyFileViewerTransport'

const FOLDER_TASK_QUERY_DEADLINE_MS = 8000

/**
 * The remaining Electron file-viewer compatibility surface is deliberately
 * enumerated.  This module must not acquire the broad preload object itself:
 * the renderer entry supplies this capability once for the explicit Desktop
 * compatibility path.
 */
export type LegacyFileGatewayApi = Readonly<{
  deleteEntry: (path: string) => Promise<void>
  getFileInfo: (path: string) => Promise<FileViewerFileInfo>
  getFilePreviewSource: (path: string) => Promise<FileViewerPreviewSource>
  getFileTextMetadata: (request: { path: string; projectRoot: string }) => Promise<FileViewerTextMetadata>
  getGitDiff: (path: string) => Promise<FileViewerGitDiff>
  getGitRepoInfo: (path: string) => Promise<FileViewerGitRepoInfo>
  listDirectory: (path: string) => Promise<FileExplorerEntry[]>
  mkdir: (path: string) => Promise<void>
  onFileWatchEvent: (listener: (message: FileViewerWatchEvent) => void) => () => void
  readFileBytes: (request: { path: string; start: number; length: number }) => Promise<FileViewerByteRange>
  readFileText: (request: { path: string; start: number; length: number; encoding?: FileViewerTextEncoding }) => Promise<FileViewerTextRange>
  readFileTextLines: (request: { lineCount: number; path: string; projectRoot: string; startLine: number }) => Promise<FileViewerTextWindow>
  renameEntry: (oldPath: string, newPath: string) => Promise<void>
  saveFile: (request: FileViewerSaveRequest) => Promise<FileViewerSaveResult>
  saveSparseFile: (request: FileViewerSparseFileSaveRequest) => Promise<FileViewerSaveResult>
  unwatchFile: (path: string) => Promise<void>
  watchFile: (path: string) => Promise<void>
}>

/**
 * Compatibility callers may receive the broad preload object at the one
 * renderer-entry hand-off, but the file viewer must not retain it. Capture
 * exactly the operations this adapter is allowed to use and freeze wrappers
 * that cannot observe later preload-object replacement.
 */
export function captureLegacyFileViewerCapability(api: LegacyFileGatewayApi): LegacyFileGatewayApi {
  const {
    deleteEntry,
    getFileInfo,
    getFilePreviewSource,
    getFileTextMetadata,
    getGitDiff,
    getGitRepoInfo,
    listDirectory,
    mkdir,
    onFileWatchEvent,
    readFileBytes,
    readFileText,
    readFileTextLines,
    renameEntry,
    saveFile,
    saveSparseFile,
    unwatchFile,
    watchFile,
  } = api
  for (const [name, value] of Object.entries({
    deleteEntry,
    getFileInfo,
    getFilePreviewSource,
    getFileTextMetadata,
    getGitDiff,
    getGitRepoInfo,
    listDirectory,
    mkdir,
    onFileWatchEvent,
    readFileBytes,
    readFileText,
    readFileTextLines,
    renameEntry,
    saveFile,
    saveSparseFile,
    unwatchFile,
    watchFile,
  })) {
    if (typeof value !== 'function') throw new TypeError(`legacy file-viewer capability ${name} is unavailable`)
  }

  return Object.freeze({
    deleteEntry: (path) => deleteEntry(path),
    getFileInfo: (path) => getFileInfo(path),
    getFilePreviewSource: (path) => getFilePreviewSource(path),
    getFileTextMetadata: (request) => getFileTextMetadata(request),
    getGitDiff: (path) => getGitDiff(path),
    getGitRepoInfo: (path) => getGitRepoInfo(path),
    listDirectory: (path) => listDirectory(path),
    mkdir: (path) => mkdir(path),
    onFileWatchEvent: (listener) => onFileWatchEvent(listener),
    readFileBytes: (request) => readFileBytes(request),
    readFileText: (request) => readFileText(request),
    readFileTextLines: (request) => readFileTextLines(request),
    renameEntry: (oldPath, newPath) => renameEntry(oldPath, newPath),
    saveFile: (request) => saveFile(request),
    saveSparseFile: (request) => saveSparseFile(request),
    unwatchFile: (path) => unwatchFile(path),
    watchFile: (path) => watchFile(path),
  })
}

function detectMimeType(path: string): string | null {
  const extension = path.toLowerCase().split('.').pop()
  switch (extension) {
    case 'md':
    case 'markdown':
      return 'text/markdown'
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'svg':
      return 'image/svg+xml'
    case 'pdf':
      return 'application/pdf'
    case 'json':
      return 'application/json'
    default:
      return null
  }
}

function decodeBase64(base64: string): string {
  try {
    return decodeURIComponent(escape(window.atob(base64)))
  } catch {
    return window.atob(base64)
  }
}

export function createTerminayFileGateway(
  api: LegacyFileGatewayApi,
  fileViewerClient = new FileViewerClient(createLegacyFileViewerTransport(api)),
): FileViewerGateway {
  return {
    async aggregateFolderMarkdownTasks(path: string, projectRootPath: string, options = {}) {
      return fileViewerClient.getFolderMarkdownTasks(toProjectRelativePath(projectRootPath, path), undefined, options, { deadlineMs: FOLDER_TASK_QUERY_DEADLINE_MS })
    },
    async getFileDiff(path: string): Promise<GitFileDiff> {
      return toGitFileDiff(await fileViewerClient.getGitDiff(path) as unknown as FileViewerGitDiff)
    },
  async getFileInfo(path: string): Promise<FileInfo> {
    const fileInfo = toFileInfo(await api.getFileInfo(path))
    const viewerCapabilities = await fileViewerClient.getCapabilities(path)
    const mimeType = detectMimeType(path)
    const nextInfo: FileInfo = {
      ...fileInfo,
      isBinary: viewerCapabilities.isBinary,
      isLargeFile: viewerCapabilities.isLargeFile,
      mimeType: viewerCapabilities.mimeType ?? mimeType,
      mtimeMs: viewerCapabilities.mtimeMs ?? fileInfo.mtimeMs,
      size: viewerCapabilities.size,
      viewerCapabilities,
    }

    return nextInfo
  },
  getGitRepoInfo(path: string) {
    return api.getGitRepoInfo(path)
  },
  async getMutationRevision(path: string) {
    const info = await api.getFileInfo(path)
    return { ino: info.ino, mtimeMs: info.mtimeMs, size: info.size }
  },
  getPreviewSource(path: string) {
    return api.getFilePreviewSource(path)
  },
  onFileWatchEvent(listener: (event: FileWatchEvent) => void) {
    return api.onFileWatchEvent((message) => {
      listener({
        exists: message.exists,
        mtimeMs: message.info?.mtimeMs ?? null,
        path: message.path,
        size: message.info?.size ?? 0,
        type:
          message.event === 'changed'
            ? 'updated'
            : message.event,
      })
    })
  },
  readFileBytes(path: string, range: FileRangeRequest): Promise<FileReadResponse> {
    return api.readFileBytes({
      length: range.length,
      path,
      start: range.offset,
    }).then((response) => ({
      base64: response.dataBase64,
      byteLength: response.length,
    }))
  },
  async readFileText(path: string): Promise<string> {
    const info = await api.getFileInfo(path)
    if (info.size === 0) {
      return ''
    }

    const response = await api.readFileText({
      length: info.size,
      path,
      start: 0,
    })

    return response.text.length > 0 ? response.text : decodeBase64((await this.readFileBytes(path, { length: info.size, offset: 0 })).base64)
  },
  async readFileTextWindow(path: string, range: FileRangeRequest): Promise<FileTextWindow> {
    const response = await api.readFileText({
      length: range.length,
      path,
      start: range.offset,
    })
    const lineCount = response.text.length === 0 ? 0 : response.text.split(/\r?\n/).length

    return {
      endLine: lineCount,
      lineEndOffset: response.start + response.length,
      lineStartOffset: response.start,
      startLine: 0,
      text: response.text,
    }
  },
  saveFile(path: string, payload: FileSavePayload): Promise<FileInfo> {
    return api
      .saveFile(
        payload.kind === 'text'
          ? {
              data: payload.text,
              kind: 'text',
              path,
            }
          : {
              dataBase64: payload.base64,
              kind: 'base64',
              path,
            },
      )
      .then(() => this.getFileInfo(path))
  },
  unwatchFile(path: string): Promise<void> {
    return api.unwatchFile(path)
  },
  watchFile(path: string): Promise<void> {
    return api.watchFile(path)
  },
  }
}

function toProjectRelativePath(projectRootPath: string, candidatePath: string): string {
  const root = normalizePath(projectRootPath)
  const candidate = normalizePath(candidatePath)
  if (candidate === root) return "."
  const prefix = root.endsWith("/") ? root : `${root}/`
  if (!candidate.startsWith(prefix)) throw new TypeError("folder path is outside the project root")
  return candidate.slice(prefix.length) || "."
}

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  if (normalized === "/") return normalized
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized
}

export function createTerminayFileViewerClient(transport: QueryCommandTransport): FileViewerClient {
  return new FileViewerClient(transport)
}

/** Compatibility constructor for shared file-viewer components while the
 * Desktop host is wiring a real framed TerminayClient transport. */
export function createLegacyFileViewerClient(api: LegacyFileGatewayApi): FileViewerClient {
  return new FileViewerClient(createLegacyFileViewerTransport(api))
}
