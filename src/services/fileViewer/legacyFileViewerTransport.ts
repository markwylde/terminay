import type { QueryCommandTransport } from '@terminay/client-core'
import type { JsonValue } from '@terminay/protocol'
import type { FileViewerSparseFileEdit } from '../../types/terminay'
import type { LegacyFileGatewayApi } from './terminayFileGateway'

/**
 * Compatibility-only adapter for the one file-viewer query still hosted by
 * Electron preload. Shared UI code talks to FileViewerClient; named
 * compatibility callers must pass the narrow host capability they adapt.
 */
export type LegacyFileViewerApi = Pick<
  LegacyFileGatewayApi,
  'deleteEntry' | 'getFileInfo' | 'getGitDiff' | 'getFileTextMetadata' | 'listDirectory' | 'mkdir' | 'readFileTextLines' | 'renameEntry' | 'saveSparseFile'
>

export function createLegacyFileViewerTransport(api: LegacyFileViewerApi): QueryCommandTransport {
  return {
    async query<T extends JsonValue = JsonValue>(operation: string, payload: JsonValue = {}): Promise<T> {
      const record = readRecord(payload)
      if (operation === 'files.preview-metadata') {
        const path = readPath(record)
        return (await createLegacyPreviewMetadata(api, path)) as T
      }
      if (operation === 'file.get-git-diff') {
        const path = readPath(record)
        return (await api.getGitDiff(path)) as unknown as T
      }
      if (operation === 'file.text-metadata') {
        return (await api.getFileTextMetadata({ path: readString(record.path, 'file path'), projectRoot: readString(record.projectRoot, 'project root') })) as unknown as T
      }
      if (operation === 'file.text-lines') {
        const startLine = readUInt(record.startLine, 'start line')
        const lineCount = readUInt(record.lineCount, 'line count')
        if (lineCount < 1 || lineCount > 512) throw new RangeError('line count is invalid')
        return (await api.readFileTextLines({ lineCount, path: readString(record.path, 'file path'), projectRoot: readString(record.projectRoot, 'project root'), startLine })) as unknown as T
      }
      if (operation === 'files.list') {
        const path = readPath(record)
        const entries = await api.listDirectory(path)
        return {
          root: path,
          offset: 0,
          entries: entries.map((entry) => ({
            name: entry.name,
            relativePath: entry.path,
            kind: entry.isDirectory ? 'directory' : 'file',
            isSymbolicLink: entry.isSymbolicLink,
            accessible: true,
            size: entry.size ?? 0,
            ...(entry.modifiedAtMs == null ? {} : { mtimeMs: entry.modifiedAtMs }),
            ...(entry.mode == null ? {} : { mode: entry.mode }),
          })),
          truncated: false,
        } as unknown as T
      }
      throw new Error(`legacy file query is unsupported: ${operation}`)
    },
    async command<T extends JsonValue = JsonValue>(operation: string, payload: JsonValue = {}): Promise<T> {
      const record = readRecord(payload)
      if (operation === 'files.create-directory') {
        await api.mkdir(readPath(record))
        return null as T
      }
      if (operation === 'files.rename') {
        await api.renameEntry(readPath(record), readString(record.destination, 'destination path'))
        return null as T
      }
      if (operation === 'files.delete') {
        if (record.recursive !== true) throw new TypeError('legacy file deletion must be recursive')
        await api.deleteEntry(readPath(record))
        return null as T
      }
      if (operation !== 'file.save-sparse') throw new Error(`legacy file command is unsupported: ${operation}`)
      const edits = record.edits
      if (!Array.isArray(edits) || edits.length > 4096) throw new TypeError('file edits are invalid')
      const request = {
        edits: edits as unknown as FileViewerSparseFileEdit[],
        expectedIno: readUInt(record.expectedIno, 'expected ino'),
        expectedMtimeMs: readFiniteNumber(record.expectedMtimeMs, 'expected mtime'),
        expectedSize: readUInt(record.expectedSize, 'expected size'),
        path: readString(record.path, 'file path'),
        projectRoot: readString(record.projectRoot, 'project root'),
      }
      await api.saveSparseFile(request)
      return null as T
    },
  }
}

async function createLegacyPreviewMetadata(api: LegacyFileViewerApi, path: string): Promise<JsonValue> {
  const info = await api.getFileInfo(path)
  const extension = info.extension.toLowerCase()
  const mimeType = mimeTypeForExtension(extension)
  const previewKind = extension === '.pdf'
    ? 'pdf'
    : mimeType?.startsWith('image/') === true
      ? 'image'
      : ['.md', '.markdown', '.mdown', '.mkd'].includes(extension)
        ? 'markdown'
        : isTextExtension(extension)
          ? 'text'
          : 'hex'
  const isBinary = info.isFile && (previewKind === 'hex' || previewKind === 'image' || previewKind === 'pdf')
  const canEditText = info.isFile && !isBinary
  const canEditHex = info.isFile
  const safePreview = info.size <= 8 * 1024 * 1024 && ['markdown', 'image', 'pdf', 'text'].includes(previewKind)
  return {
    relativePath: path,
    size: info.size,
    ...(info.mtimeMs === null ? {} : { mtimeMs: info.mtimeMs }),
    ...(mimeType === undefined ? {} : { mimeType }),
    previewKind,
    preferredMode: safePreview ? 'preview' : canEditText ? 'text' : 'hex',
    isBinary,
    isLargeFile: info.size > 100 * 1024 * 1024,
    safePreview,
    canEditText,
    canEditHex,
    inspectedBytes: 0,
    inspectionTruncated: info.size > 0,
  }
}

function isTextExtension(extension: string): boolean {
  return ['.c', '.cc', '.conf', '.cpp', '.css', '.csv', '.env', '.go', '.graphql', '.h', '.html', '.ini', '.java', '.js', '.jsx', '.json', '.log', '.mjs', '.py', '.rb', '.rs', '.sh', '.sql', '.svg', '.toml', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml'].includes(extension)
}

function mimeTypeForExtension(extension: string): string | undefined {
  if (['.jpg', '.jpeg'].includes(extension)) return 'image/jpeg'
  if (extension === '.png') return 'image/png'
  if (extension === '.gif') return 'image/gif'
  if (extension === '.svg') return 'image/svg+xml'
  if (extension === '.pdf') return 'application/pdf'
  if (['.md', '.markdown', '.mdown', '.mkd'].includes(extension)) return 'text/markdown'
  if (extension === '.json') return 'application/json'
  if (isTextExtension(extension)) return 'text/plain'
  return undefined
}

function readPath(payload: JsonValue): string {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload) || typeof payload.path !== 'string' || payload.path.length === 0 || payload.path.length > 4096 || payload.path.includes('\0')) {
    throw new TypeError('file query path is invalid')
  }
  return payload.path
}

function readRecord(payload: JsonValue): Record<string, JsonValue> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new TypeError('file query payload is invalid')
  return payload
}

function readString(value: JsonValue | undefined, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || value.includes('\0')) throw new TypeError(`${name} is invalid`)
  return value
}

function readUInt(value: JsonValue | undefined, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} is invalid`)
  return value
}

function readFiniteNumber(value: JsonValue | undefined, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} is invalid`)
  return value
}
