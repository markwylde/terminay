import type { QueryCommandTransport } from '@terminay/client-core'
import type { JsonValue } from '@terminay/protocol'
import type { FileViewerSparseFileEdit } from '../../types/terminay'

/**
 * Compatibility-only adapter for the one file-viewer query still hosted by
 * Electron preload. Shared UI code talks to FileViewerClient; this boundary
 * is the only place that translates the legacy bridge during migration.
 */
export function createLegacyFileViewerTransport(): QueryCommandTransport {
  return {
    async query<T extends JsonValue = JsonValue>(operation: string, payload: JsonValue = {}): Promise<T> {
      const record = readRecord(payload)
      if (operation === 'file.get-git-diff') {
        const path = readPath(record)
        return (await window.terminay.getGitDiff(path)) as unknown as T
      }
      if (operation === 'file.text-metadata') {
        return (await window.terminay.getFileTextMetadata({ path: readString(record.path, 'file path'), projectRoot: readString(record.projectRoot, 'project root') })) as unknown as T
      }
      if (operation === 'file.text-lines') {
        const startLine = readUInt(record.startLine, 'start line')
        const lineCount = readUInt(record.lineCount, 'line count')
        if (lineCount < 1 || lineCount > 512) throw new RangeError('line count is invalid')
        return (await window.terminay.readFileTextLines({ lineCount, path: readString(record.path, 'file path'), projectRoot: readString(record.projectRoot, 'project root'), startLine })) as unknown as T
      }
      throw new Error(`legacy file query is unsupported: ${operation}`)
    },
    async command<T extends JsonValue = JsonValue>(operation: string, payload: JsonValue = {}): Promise<T> {
      if (operation !== 'file.save-sparse') throw new Error(`legacy file command is unsupported: ${operation}`)
      const record = readRecord(payload)
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
      await window.terminay.saveSparseFile(request)
      return null as T
    },
  }
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
