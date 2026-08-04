import { randomUUID } from 'node:crypto'
import type { Stats } from 'node:fs'
import { lstat, open, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import type {
  FileViewerByteRange,
  FileViewerFileInfo,
  FileViewerPreviewSource,
  FileViewerSaveRequest,
  FileViewerSaveResult,
  FileViewerSparseFileSaveRequest,
  FileViewerTextEncoding,
  FileViewerTextLine,
  FileViewerTextMetadata,
  FileViewerTextRange,
  FileViewerTextWindow,
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

const TEXT_INDEX_CHUNK_BYTES = 64 * 1024
const TEXT_INDEX_CHECKPOINT_LINES = 256
export const MAX_TEXT_INDEX_BYTES_PER_REQUEST = 4 * 1024 * 1024
const MAX_TEXT_WINDOW_LINES = 512
const MAX_TEXT_LINE_BYTES = 1024 * 1024
const MAX_SPARSE_FILE_EDITS = 10_000
const MAX_SPARSE_FILE_EDIT_BYTES = 1024 * 1024
const MAX_SPARSE_FILE_INSERTED_BYTES = 8 * 1024 * 1024

type TextIndex = FileViewerTextMetadata & {
  checkpoints: Array<{ lineNumber: number; offset: number }>
  decoder: TextDecoder
}

type ScopedFile = {
  canonicalPath: string
  canonicalProjectRoot: string
  stats: Stats
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
  private readonly textIndexes = new Map<string, TextIndex>()
  private readonly textIndexAdvances = new Map<string, Promise<void>>()

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
        ino: Number.isFinite(fileStats.ino) ? fileStats.ino : null,
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
        ino: null,
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

  async getTextMetadata(rawPath: string, rawProjectRoot: string): Promise<FileViewerTextMetadata> {
    const scoped = await this.resolveScopedFile(rawPath, rawProjectRoot)
    let index = this.textIndexes.get(scoped.canonicalPath)
    if (
      !index ||
      index.ino !== scoped.stats.ino ||
      index.size !== scoped.stats.size ||
      index.mtimeMs !== scoped.stats.mtimeMs
    ) {
      index = this.createTextIndex(scoped)
      this.textIndexes.set(scoped.canonicalPath, index)
    }

    if (!index.isComplete) {
      try {
        await this.advanceTextIndex(index)
      } catch (error) {
        if (this.textIndexes.get(scoped.canonicalPath) === index) {
          this.textIndexes.delete(scoped.canonicalPath)
        }
        throw error
      }
    }
    return this.toTextMetadata(index)
  }

  async readTextLines(
    rawPath: string,
    rawProjectRoot: string,
    requestedStartLine: number,
    requestedLineCount: number,
  ): Promise<FileViewerTextWindow> {
    if (!Number.isSafeInteger(requestedStartLine) || requestedStartLine < 0) {
      throw new Error('Text window start line must be a non-negative safe integer.')
    }
    if (
      !Number.isSafeInteger(requestedLineCount) ||
      requestedLineCount < 1 ||
      requestedLineCount > MAX_TEXT_WINDOW_LINES
    ) {
      throw new Error(`Text windows must contain between 1 and ${MAX_TEXT_WINDOW_LINES} lines.`)
    }

    const scoped = await this.resolveScopedFile(rawPath, rawProjectRoot)
    let index = this.textIndexes.get(scoped.canonicalPath)
    if (
      !index ||
      index.ino !== scoped.stats.ino ||
      index.size !== scoped.stats.size ||
      index.mtimeMs !== scoped.stats.mtimeMs
    ) {
      await this.getTextMetadata(scoped.canonicalPath, scoped.canonicalProjectRoot)
      index = this.textIndexes.get(scoped.canonicalPath)
    }
    if (!index) {
      throw new Error('Text index became unavailable.')
    }
    if (!index.isComplete && requestedStartLine >= index.lineCount) {
      throw new Error('The requested text window is beyond the indexed range.')
    }

    const startLine = Math.min(requestedStartLine, Math.max(0, index.lineCount - 1))
    const endLine = Math.min(index.lineCount, startLine + requestedLineCount)
    const checkpoint =
      [...index.checkpoints].reverse().find((candidate) => candidate.lineNumber <= startLine) ??
      index.checkpoints[0]
    const lines: FileViewerTextLine[] = []
    const handle = await open(scoped.canonicalPath, 'r')

    try {
      let fileOffset = checkpoint.offset
      let currentLine = checkpoint.lineNumber
      let lineStart = checkpoint.offset
      let lineParts: Buffer[] = []
      let lineByteLength = 0

      const appendPart = (part: Buffer) => {
        if (currentLine < startLine || currentLine >= endLine || part.length === 0) {
          return
        }
        lineByteLength += part.length
        if (lineByteLength > MAX_TEXT_LINE_BYTES) {
          throw new Error(`Line ${currentLine + 1} exceeds the ${MAX_TEXT_LINE_BYTES} byte editor limit.`)
        }
        lineParts.push(part)
      }

      const finishLine = (newlineOffset: number, hasNewline: boolean) => {
        if (currentLine >= startLine && currentLine < endLine) {
          let bytes = lineParts.length === 1 ? lineParts[0] : Buffer.concat(lineParts, lineByteLength)
          let contentEnd = newlineOffset
          let eol: FileViewerTextLine['eol'] = hasNewline ? '\n' : ''
          if (hasNewline && bytes[bytes.length - 1] === 0x0d) {
            bytes = bytes.subarray(0, -1)
            contentEnd -= 1
            eol = '\r\n'
          }
          let text: string
          try {
            text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
          } catch {
            throw new Error(`Line ${currentLine + 1} contains invalid UTF-8.`)
          }
          lines.push({
            end: contentEnd,
            eol,
            lineNumber: currentLine,
            start: lineStart,
            text,
          })
        }
        currentLine += 1
        lineStart = hasNewline ? newlineOffset + 1 : newlineOffset
        lineParts = []
        lineByteLength = 0
      }

      while (fileOffset < scoped.stats.size && currentLine < endLine) {
        const buffer = Buffer.allocUnsafe(Math.min(TEXT_INDEX_CHUNK_BYTES, scoped.stats.size - fileOffset))
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, fileOffset)
        if (bytesRead === 0) {
          break
        }
        const bytes = buffer.subarray(0, bytesRead)
        let segmentStart = 0
        let newlineIndex = bytes.indexOf(0x0a)

        while (newlineIndex >= 0 && currentLine < endLine) {
          appendPart(bytes.subarray(segmentStart, newlineIndex))
          finishLine(fileOffset + newlineIndex, true)
          segmentStart = newlineIndex + 1
          newlineIndex = bytes.indexOf(0x0a, segmentStart)
        }
        appendPart(bytes.subarray(segmentStart))
        fileOffset += bytesRead
      }

      if (currentLine < endLine && fileOffset >= scoped.stats.size) {
        finishLine(scoped.stats.size, false)
      }
    } finally {
      await handle.close()
    }

    return {
      lineCount: index.lineCount,
      lines,
      path: scoped.canonicalPath,
      startLine,
    }
  }

  async saveSparseFile(payload: FileViewerSparseFileSaveRequest): Promise<FileViewerSaveResult> {
    const scoped = await this.resolveScopedFile(payload.path, payload.projectRoot)
    if (
      scoped.stats.ino !== payload.expectedIno ||
      scoped.stats.size !== payload.expectedSize ||
      scoped.stats.mtimeMs !== payload.expectedMtimeMs
    ) {
      throw new Error('File changed on disk before the sparse draft could be saved.')
    }
    if (!Array.isArray(payload.edits) || payload.edits.length < 1 || payload.edits.length > MAX_SPARSE_FILE_EDITS) {
      throw new Error(`Sparse saves require between 1 and ${MAX_SPARSE_FILE_EDITS} edits.`)
    }

    let previousEnd = 0
    let insertedBytes = 0
    const edits = payload.edits.map((edit, index) => {
      if (
        !Number.isSafeInteger(edit.start) ||
        !Number.isSafeInteger(edit.end) ||
        edit.start < previousEnd ||
        edit.end < edit.start ||
        edit.end > scoped.stats.size
      ) {
        throw new Error('Sparse file edits must be sorted, non-overlapping byte ranges within the file.')
      }
      if (index > 0 && edit.start < payload.edits[index - 1].end) {
        throw new Error('Sparse file edits must not overlap.')
      }
      const replacement = Buffer.from(edit.dataBase64, 'base64')
      if (replacement.length > MAX_SPARSE_FILE_EDIT_BYTES) {
        throw new Error(`A sparse file edit exceeds the ${MAX_SPARSE_FILE_EDIT_BYTES} byte limit.`)
      }
      if (replacement.toString('base64').replace(/=+$/, '') !== edit.dataBase64.replace(/=+$/, '')) {
        throw new Error('Sparse file edit data is not valid base64.')
      }
      insertedBytes += replacement.length
      if (insertedBytes > MAX_SPARSE_FILE_INSERTED_BYTES) {
        throw new Error(`Sparse file edits exceed the ${MAX_SPARSE_FILE_INSERTED_BYTES} byte total limit.`)
      }
      previousEnd = edit.end
      return { ...edit, replacement }
    })

    const tempPath = path.join(
      path.dirname(scoped.canonicalPath),
      `.${path.basename(scoped.canonicalPath)}.${randomUUID()}.tmp`,
    )
    const source = await open(scoped.canonicalPath, 'r')
    let destination: Awaited<ReturnType<typeof open>> | null = null

    try {
      destination = await open(tempPath, 'wx', scoped.stats.mode)
      let sourceOffset = 0
      let destinationOffset = 0

      const writeAll = async (buffer: Buffer) => {
        let written = 0
        while (written < buffer.length) {
          const result = await destination?.write(
            buffer,
            written,
            buffer.length - written,
            destinationOffset + written,
          )
          if (!result || result.bytesWritten === 0) {
            throw new Error('Unable to write the sparse file temporary file.')
          }
          written += result.bytesWritten
        }
        destinationOffset += written
      }

      const copyRange = async (end: number) => {
        const buffer = Buffer.allocUnsafe(TEXT_INDEX_CHUNK_BYTES)
        while (sourceOffset < end) {
          const length = Math.min(buffer.length, end - sourceOffset)
          const { bytesRead } = await source.read(buffer, 0, length, sourceOffset)
          if (bytesRead === 0) {
            throw new Error('File ended while applying sparse file edits.')
          }
          await writeAll(buffer.subarray(0, bytesRead))
          sourceOffset += bytesRead
        }
      }

      for (const edit of edits) {
        await copyRange(edit.start)
        sourceOffset = edit.end
        if (edit.replacement.length > 0) {
          await writeAll(edit.replacement)
        }
      }
      await copyRange(scoped.stats.size)
      await destination.sync()
      await destination.close()
      destination = null

      const beforeReplace = await this.resolveScopedFile(payload.path, payload.projectRoot)
      if (
        beforeReplace.stats.dev !== scoped.stats.dev ||
        beforeReplace.stats.ino !== scoped.stats.ino ||
        beforeReplace.stats.size !== scoped.stats.size ||
        beforeReplace.stats.mtimeMs !== scoped.stats.mtimeMs
      ) {
        throw new Error('File changed on disk while the sparse draft was being saved.')
      }

      await rename(tempPath, scoped.canonicalPath)
      const directory = await open(path.dirname(scoped.canonicalPath), 'r')
      try {
        await directory.sync()
      } finally {
        await directory.close()
      }
      this.textIndexes.delete(scoped.canonicalPath)
    } catch (error) {
      await destination?.close().catch(() => undefined)
      await rm(tempPath, { force: true }).catch(() => undefined)
      throw error
    } finally {
      await source.close()
    }

    const savedInfo = await this.getFileInfo(scoped.canonicalPath)
    return {
      byteLength: savedInfo.size,
      path: scoped.canonicalPath,
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

  private async resolveScopedFile(rawPath: string, rawProjectRoot: string): Promise<ScopedFile> {
    const resolvedPath = this.normalizePath(rawPath)
    const resolvedProjectRoot = this.normalizePath(rawProjectRoot)
    const [canonicalProjectRoot, targetLinkStats] = await Promise.all([
      realpath(resolvedProjectRoot),
      lstat(resolvedPath),
    ])
    if (targetLinkStats.isSymbolicLink()) {
      throw new Error('Sparse file access does not follow a file symlink.')
    }
    const canonicalPath = await realpath(resolvedPath)
    const relativePath = path.relative(canonicalProjectRoot, canonicalPath)
    if (relativePath === '' || relativePath.startsWith(`..${path.sep}`) || relativePath === '..' || path.isAbsolute(relativePath)) {
      throw new Error('File is outside the canonical project scope.')
    }
    const stats = await stat(canonicalPath)
    if (!stats.isFile()) {
      throw new Error('Sparse file access requires a regular file.')
    }
    return { canonicalPath, canonicalProjectRoot, stats }
  }

  private createTextIndex(scoped: ScopedFile): TextIndex {
    return {
      checkpoints: [{ lineNumber: 0, offset: 0 }],
      decoder: new TextDecoder('utf-8', { fatal: true }),
      indexedByteLength: 0,
      ino: scoped.stats.ino,
      isComplete: scoped.stats.size === 0,
      lineCount: 1,
      mtimeMs: scoped.stats.mtimeMs,
      path: scoped.canonicalPath,
      size: scoped.stats.size,
    }
  }

  private async advanceTextIndex(index: TextIndex): Promise<void> {
    const existingAdvance = this.textIndexAdvances.get(index.path)
    if (existingAdvance) {
      await existingAdvance
      return
    }

    const currentAdvance = Promise.resolve().then(async () => {
      if (index.isComplete) {
        return
      }

      const requestEnd = Math.min(
        index.size,
        index.indexedByteLength + MAX_TEXT_INDEX_BYTES_PER_REQUEST,
      )
      const handle = await open(index.path, 'r')

      try {
        while (index.indexedByteLength < requestEnd) {
          const buffer = Buffer.allocUnsafe(
            Math.min(TEXT_INDEX_CHUNK_BYTES, requestEnd - index.indexedByteLength),
          )
          const { bytesRead } = await handle.read(
            buffer,
            0,
            buffer.length,
            index.indexedByteLength,
          )
          if (bytesRead === 0) {
            throw new Error('File ended while building its ranged text index.')
          }
          const bytes = buffer.subarray(0, bytesRead)
          index.decoder.decode(bytes, { stream: true })
          for (
            let newlineIndex = bytes.indexOf(0x0a);
            newlineIndex >= 0;
            newlineIndex = bytes.indexOf(0x0a, newlineIndex + 1)
          ) {
            index.lineCount += 1
            if ((index.lineCount - 1) % TEXT_INDEX_CHECKPOINT_LINES === 0) {
              index.checkpoints.push({
                lineNumber: index.lineCount - 1,
                offset: index.indexedByteLength + newlineIndex + 1,
              })
            }
          }
          index.indexedByteLength += bytesRead
        }

        if (index.indexedByteLength === index.size) {
          index.decoder.decode()
          index.isComplete = true
        }
      } catch (error) {
        if (error instanceof TypeError) {
          throw new Error('Performant text mode requires valid UTF-8.')
        }
        throw error
      } finally {
        await handle.close()
      }
    })

    this.textIndexAdvances.set(index.path, currentAdvance)
    try {
      await currentAdvance
    } finally {
      if (this.textIndexAdvances.get(index.path) === currentAdvance) {
        this.textIndexAdvances.delete(index.path)
      }
    }
  }

  private toTextMetadata(index: TextIndex): FileViewerTextMetadata {
    return {
      indexedByteLength: index.indexedByteLength,
      ino: index.ino,
      isComplete: index.isComplete,
      lineCount: index.lineCount,
      mtimeMs: index.mtimeMs,
      path: index.path,
      size: index.size,
    }
  }
}
