import { FileViewerClient, type FileObservationClient } from '@terminay/client-core'
import type {
  FileInfo,
  FileRangeRequest,
  FileReadResponse,
  FileSavePayload,
  FileTextWindow,
  FileViewerGateway,
  GitFileDiff,
} from '../../types/fileViewer'

const MAX_READ_BYTES = 128 * 1024 * 1024
const RANGE_BYTES = 1024 * 1024
const FOLDER_TASK_QUERY_DEADLINE_MS = 8000

/**
 * Read-only server-backed projection for the existing FilePanel. It keeps the
 * panel's Desktop path as presentation data but converts it to the canonical
 * project-relative protocol path before every server read. Writes, watches,
 * and Git discovery deliberately remain on the supplied compatibility gateway
 * until their server operations are composed into the Desktop host.
 */
export function createServerFileGateway(options: Readonly<{
  client: FileViewerClient
  observationClient?: FileObservationClient
  projectId: string
  projectRoot: string
  compatibilityGateway?: FileViewerGateway
}>): FileViewerGateway {
  const relative = (path: string) => toProjectRelativePath(options.projectRoot, path)
  const watchListeners = new Set<Parameters<FileViewerGateway['onFileWatchEvent']>[0]>()
  const watches = new Map<string, { subscriptionId: string; unsubscribe: () => void }>()
  const readBytes = async (path: string, range: FileRangeRequest): Promise<FileReadResponse> => {
    if (!Number.isSafeInteger(range.offset) || range.offset < 0 || !Number.isSafeInteger(range.length) || range.length < 0 || range.length > MAX_READ_BYTES) {
      throw new RangeError('file read range is invalid')
    }
    const chunks: Uint8Array[] = []
    let offset = range.offset
    let remaining = range.length
    while (remaining > 0) {
      const length = Math.min(remaining, RANGE_BYTES)
      const result = await options.client.readContentRange(relative(path), offset, length, options.projectId)
      chunks.push(result.bytes)
      offset += result.bytes.byteLength
      remaining -= result.bytes.byteLength
      if (result.bytes.byteLength < length || result.truncated) break
    }
    const bytes = joinBytes(chunks)
    return { base64: bytesToBase64(bytes), byteLength: bytes.byteLength }
  }

  return {
    async aggregateFolderMarkdownTasks(path, _projectRootPath, taskOptions = {}) {
      return options.client.getFolderMarkdownTasks(relative(path), options.projectId, taskOptions, { deadlineMs: FOLDER_TASK_QUERY_DEADLINE_MS })
    },
    getFileDiff: options.compatibilityGateway?.getFileDiff ?? unsupportedFileDiff,
    async getFileInfo(path: string): Promise<FileInfo> {
      const capabilities = await options.client.getCapabilities(relative(path), options.projectId)
      return {
        exists: true,
        extension: extensionOf(path),
        ino: null,
        isBinary: capabilities.isBinary,
        isDirectory: false,
        isFile: true,
        isLargeFile: capabilities.isLargeFile,
        isSymbolicLink: false,
        mimeType: capabilities.mimeType ?? null,
        mtimeMs: capabilities.mtimeMs ?? null,
        name: nameOf(path),
        path,
        size: capabilities.size,
        viewerCapabilities: capabilities,
      }
    },
    getGitRepoInfo: options.compatibilityGateway?.getGitRepoInfo ?? unsupportedGitRepoInfo,
    getPreviewSource: options.compatibilityGateway?.getPreviewSource ?? unsupportedPreviewSource,
    onFileWatchEvent(listener) {
      watchListeners.add(listener)
      return () => watchListeners.delete(listener)
    },
    readFileBytes: readBytes,
    async readFileText(path: string): Promise<string> {
      const info = await options.client.getCapabilities(relative(path), options.projectId)
      if (info.size > MAX_READ_BYTES) throw new RangeError('file is too large for an in-memory text read')
      const bytes = await readBytes(path, { offset: 0, length: info.size })
      return new TextDecoder().decode(base64ToBytes(bytes.base64))
    },
    async readFileTextWindow(path: string, range: FileRangeRequest): Promise<FileTextWindow> {
      const bytes = await readBytes(path, range)
      const text = new TextDecoder().decode(base64ToBytes(bytes.base64))
      const lineCount = text.length === 0 ? 0 : text.split(/\r?\n/).length
      return { endLine: lineCount, lineEndOffset: range.offset + bytes.byteLength, lineStartOffset: range.offset, startLine: 0, text }
    },
    async saveFile(path: string, payload: FileSavePayload): Promise<FileInfo> {
      if (payload.kind !== 'text') throw new Error('Server-backed binary saves are not available yet.')
      const session = await options.client.openFile(relative(path), options.projectId)
      await options.client.editSession(session.sessionId, payload.text)
      await options.client.saveSession(session.sessionId)
      return this.getFileInfo(path)
    },
    async unwatchFile(path) {
      const watch = watches.get(path)
      if (watch === undefined) return
      watches.delete(path)
      watch.unsubscribe()
      await options.observationClient?.stopWatch(watch.subscriptionId)
    },
    async watchFile(path) {
      if (watches.has(path)) return
      if (options.observationClient === undefined) {
        throw new Error('Server file observation is unavailable.')
      }
      const handle = await options.observationClient.startWatch(options.projectId, relative(path))
      const unsubscribe = await options.observationClient.subscribeWatch(handle, (event) => {
        void (async () => {
          const deleted = event.kind === 'deleted' || event.kind === 'unavailable'
          const info = deleted ? undefined : await options.client.getCapabilities(event.resource, options.projectId).catch(() => undefined)
          for (const listener of watchListeners) {
            listener({
              exists: !deleted && info !== undefined,
              mtimeMs: info?.mtimeMs ?? null,
              path,
              size: info?.size ?? 0,
              type: event.kind === 'deleted' ? 'deleted' : event.kind === 'renamed' ? 'renamed' : 'updated',
            })
          }
        })()
      }, () => {
        for (const listener of watchListeners) {
          listener({ exists: true, mtimeMs: null, path, size: 0, type: 'updated' })
        }
      })
      watches.set(path, { subscriptionId: handle.subscriptionId, unsubscribe })
    },
  }
}

function unsupportedFileDiff(path: string): Promise<GitFileDiff> {
  return Promise.reject(new Error(`File diff is unavailable for ${path}.`))
}

function unsupportedGitRepoInfo(): Promise<never> {
  return Promise.reject(new Error('Git repository metadata is unavailable.'))
}

function unsupportedPreviewSource(): Promise<never> {
  return Promise.reject(new Error('File preview source is unavailable.'))
}

export function toProjectRelativePath(projectRoot: string, candidatePath: string): string {
  const root = comparableMacPath(normalizePath(projectRoot))
  const candidate = comparableMacPath(normalizePath(candidatePath))
  if (!root || root === '.') return validateRelative(candidate)
  if (candidate === root) return '.'
  const prefix = root.endsWith('/') ? root : `${root}/`
  if (candidate.startsWith(prefix)) return validateRelative(candidate.slice(prefix.length))
  if (!candidate.startsWith('/')) return validateRelative(candidate)
  throw new TypeError('file path is outside the project root')
}

function comparableMacPath(path: string): string {
  return path.startsWith('/private/var/') ? path.slice('/private'.length) : path
}

function validateRelative(path: string): string {
  if (!path || path === '.') return '.'
  if (path.startsWith('/') || path.split('/').some((part) => part === '..' || part.length === 0)) throw new TypeError('file path is outside the project root')
  return path
}

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (normalized === '/') return normalized
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
}

function nameOf(path: string): string { return normalizePath(path).split('/').at(-1) || path }
function extensionOf(path: string): string {
  const name = nameOf(path)
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(index) : ''
}
function joinBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  const joined = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength }
  return joined
}
function bytesToBase64(bytes: Uint8Array): string { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary) }
function base64ToBytes(value: string): Uint8Array { return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)) }
