import { randomUUID } from 'node:crypto'
import { lstat, open, rename, rm, stat, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import type {
  FileViewerByteRange,
  FileViewerFileInfo,
  FileViewerPreviewSource,
  FileViewerSaveRequest,
  FileViewerSaveResult,
  FileViewerTextEncoding,
  FileViewerTextRange,
} from '../../src/types/terminay'
import { getPathNameParts, normalizeFileViewerPath } from './pathUtils'

const TEXT_ENCODINGS: Record<FileViewerTextEncoding, BufferEncoding> = {
  utf8: 'utf8',
  'utf-8': 'utf8',
  utf16le: 'utf16le',
  'utf-16le': 'utf16le',
  latin1: 'latin1',
  ascii: 'ascii',
}

const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.markdown': 'text/markdown',
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.webp': 'image/webp',
}

function normalizeRange(start: number, length: number): { length: number; start: number } {
  if (!Number.isFinite(start) || !Number.isFinite(length)) {
    throw new Error('File range values must be finite numbers.')
  }

  const normalizedStart = Math.max(0, Math.floor(start))
  const normalizedLength = Math.max(0, Math.floor(length))

  return {
    length: normalizedLength,
    start: normalizedStart,
  }
}

export class FileBufferService {
  constructor(private readonly getHomePath: () => string) {}

  normalizePath(rawPath: string): string {
    return normalizeFileViewerPath(rawPath, this.getHomePath())
  }

  async getFileInfo(rawPath: string): Promise<FileViewerFileInfo> {
    const resolvedPath = this.normalizePath(rawPath)
    const pathParts = getPathNameParts(resolvedPath)

    try {
      const linkStats = await lstat(resolvedPath)
      const fileStats = linkStats.isSymbolicLink() ? await stat(resolvedPath) : linkStats
      return {
        birthtimeMs: Number.isFinite(fileStats.birthtimeMs) ? fileStats.birthtimeMs : null,
        ctimeMs: Number.isFinite(fileStats.ctimeMs) ? fileStats.ctimeMs : null,
        exists: true,
        extension: pathParts.extension,
        isDirectory: fileStats.isDirectory(),
        isFile: fileStats.isFile(),
        isSymbolicLink: linkStats.isSymbolicLink(),
        mtimeMs: Number.isFinite(fileStats.mtimeMs) ? fileStats.mtimeMs : null,
        name: pathParts.name,
        path: resolvedPath,
        size: fileStats.size,
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        throw error
      }

      return {
        birthtimeMs: null,
        ctimeMs: null,
        exists: false,
        extension: pathParts.extension,
        isDirectory: false,
        isFile: false,
        isSymbolicLink: false,
        mtimeMs: null,
        name: pathParts.name,
        path: resolvedPath,
        size: 0,
      }
    }
  }

  async readBytes(rawPath: string, start: number, length: number): Promise<FileViewerByteRange> {
    const resolvedPath = this.normalizePath(rawPath)
    const range = normalizeRange(start, length)
    const info = await this.getFileInfo(resolvedPath)

    if (!info.exists || !info.isFile) {
      throw new Error(`Cannot read bytes from non-file path: ${resolvedPath}`)
    }

    if (range.length === 0) {
      return {
        dataBase64: '',
        eof: range.start >= info.size,
        length: 0,
        path: resolvedPath,
        start: range.start,
        totalSize: info.size,
      }
    }

    const handle = await open(resolvedPath, 'r')

    try {
      const buffer = Buffer.allocUnsafe(range.length)
      const { bytesRead } = await handle.read(buffer, 0, range.length, range.start)
      return {
        dataBase64: buffer.subarray(0, bytesRead).toString('base64'),
        eof: range.start + bytesRead >= info.size,
        length: bytesRead,
        path: resolvedPath,
        start: range.start,
        totalSize: info.size,
      }
    } finally {
      await handle.close()
    }
  }

  async readText(
    rawPath: string,
    start: number,
    length: number,
    encoding: FileViewerTextEncoding = 'utf8',
  ): Promise<FileViewerTextRange> {
    const resolvedPath = this.normalizePath(rawPath)
    const byteRange = await this.readBytes(resolvedPath, start, length)

    return {
      encoding,
      eof: byteRange.eof,
      length: byteRange.length,
      path: byteRange.path,
      start: byteRange.start,
      text: Buffer.from(byteRange.dataBase64, 'base64').toString(TEXT_ENCODINGS[encoding]),
      totalSize: byteRange.totalSize,
    }
  }

  async saveFile(payload: FileViewerSaveRequest): Promise<FileViewerSaveResult> {
    const resolvedPath = this.normalizePath(payload.path)
    const targetInfo = await this.getFileInfo(resolvedPath)

    if (targetInfo.exists && targetInfo.isDirectory) {
      throw new Error(`Cannot save file content to a directory: ${resolvedPath}`)
    }

    const nextContents =
      payload.kind === 'text'
        ? Buffer.from(payload.data, TEXT_ENCODINGS[payload.encoding ?? 'utf8'])
        : Buffer.from(payload.dataBase64, 'base64')

    const tempPath = path.join(path.dirname(resolvedPath), `.${path.basename(resolvedPath)}.${randomUUID()}.tmp`)

    try {
      await writeFile(tempPath, nextContents, targetInfo.exists ? { mode: (await stat(resolvedPath)).mode } : undefined)
      await rename(tempPath, resolvedPath)
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined)
      throw error
    }

    const savedInfo = await this.getFileInfo(resolvedPath)

    return {
      byteLength: nextContents.byteLength,
      path: resolvedPath,
      savedAt: new Date().toISOString(),
      size: savedInfo.size,
    }
  }

  async getPreviewSource(rawPath: string): Promise<FileViewerPreviewSource> {
    const resolvedPath = this.normalizePath(rawPath)
    const info = await this.getFileInfo(resolvedPath)

    if (!info.exists || !info.isFile) {
      throw new Error(`Cannot resolve preview source for non-file path: ${resolvedPath}`)
    }

    return {
      mimeType: MIME_TYPES_BY_EXTENSION[info.extension] ?? null,
      path: resolvedPath,
      url: pathToFileURL(resolvedPath).toString(),
    }
  }
}
