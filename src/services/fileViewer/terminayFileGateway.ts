import type {
  FileInfo,
  FileRangeRequest,
  FileReadResponse,
  FileSavePayload,
  FileWatchEvent,
  GitFileDiff,
  FileViewerGateway,
} from '../../types/fileViewer'
import { parseGitDiff, toFileInfo } from '../../types/fileViewer'
import { isTextLikeFile } from './capabilities'

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

export const terminayFileGateway: FileViewerGateway = {
  async getFileDiff(path: string): Promise<GitFileDiff> {
    const [gitDiff, repoInfo] = await Promise.all([
      window.terminay.getGitDiff(path),
      window.terminay.getGitRepoInfo(path),
    ])
    return parseGitDiff(gitDiff, repoInfo)
  },
  async getFileInfo(path: string): Promise<FileInfo> {
    const fileInfo = toFileInfo(await window.terminay.getFileInfo(path))
    const mimeType = detectMimeType(path)
    const nextInfo: FileInfo = {
      ...fileInfo,
      isBinary: false,
      mimeType,
    }

    return {
      ...nextInfo,
      isBinary: !isTextLikeFile(nextInfo) && nextInfo.isFile,
    }
  },
  getGitRepoInfo(path: string) {
    return window.terminay.getGitRepoInfo(path)
  },
  getPreviewSource(path: string) {
    return window.terminay.getFilePreviewSource(path)
  },
  onFileWatchEvent(listener: (event: FileWatchEvent) => void) {
    return window.terminay.onFileWatchEvent((message) => {
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
    return window.terminay.readFileBytes({
      length: range.length,
      path,
      start: range.offset,
    }).then((response) => ({
      base64: response.dataBase64,
      byteLength: response.length,
    }))
  },
  async readFileText(path: string): Promise<string> {
    const info = await window.terminay.getFileInfo(path)
    if (info.size === 0) {
      return ''
    }

    const response = await window.terminay.readFileText({
      length: info.size,
      path,
      start: 0,
    })

    return response.text.length > 0 ? response.text : decodeBase64((await this.readFileBytes(path, { length: info.size, offset: 0 })).base64)
  },
  saveFile(path: string, payload: FileSavePayload): Promise<FileInfo> {
    return window.terminay
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
    return window.terminay.unwatchFile(path)
  },
  watchFile(path: string): Promise<void> {
    return window.terminay.watchFile(path)
  },
}
