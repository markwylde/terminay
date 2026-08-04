import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  createWriteStream,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  type WriteStream,
} from 'node:fs'
import { open, readdir } from 'node:fs/promises'
import path from 'node:path'
import { defaultTerminalSettings, resolveTerminalTheme } from '../../src/terminalSettings'
import type { TerminalSettings, TerminalThemeSettings } from '../../src/types/settings'
import type {
  TerminalRecordingChunk,
  TerminalRecordingChunkRequest,
  TerminalRecordingListItem,
  TerminalRecordingState,
} from '../../src/types/terminay'

type RecordingSessionMetadata = {
  color?: string
  cols?: number
  cwd?: string | null
  emoji?: string
  projectColor?: string
  projectEmoji?: string
  projectId?: string
  projectTitle?: string
  rows?: number
  shell?: string | null
  title?: string
}

type RecordingServiceOptions = {
  getHomePath: () => string
  getLibraryIndexPath?: () => string
  getSettings: () => TerminalSettings
  onStateChanged?: (state: TerminalRecordingState) => void
  writeMetadataAtomically?: (filePath: string, value: unknown) => void
}

type RecordingLifecycle = 'recording' | 'completed' | 'interrupted' | 'failed'

type PersistedRecordingMetadata = {
  version: 2
  bytesWritten: number
  capturedInput: boolean
  color: string | null
  cols: number
  cwd: string | null
  durationMs: number | null
  endedAt: string | null
  errorMessage: string | null
  eventCount: number
  exitCode: number | null
  inputPolicy: 'none' | 'record-with-sensitive-filter'
  projectColor: string | null
  projectEmoji: string | null
  projectId: string | null
  projectTitle: string | null
  recordingId: string
  recordingState: RecordingLifecycle
  relativeCastPath: string
  rows: number
  sensitiveInputPolicy: 'drop' | 'mask'
  sessionId: string
  shell: string | null
  signal: number | null
  startedAt: string
  theme: TerminalThemeSettings | null
  title: string
}

type ActiveRecording = {
  bytesWritten: number
  castPath: string
  cols: number
  createdAtMs: number
  errorMessage: string | null
  eventCount: number
  lastEventAtMs: number
  metadata: PersistedRecordingMetadata
  metadataPath: string
  recordingId: string
  root: string
  roundingCarryMs: number
  rows: number
  sensitiveInputUntilMs: number
  sessionId: string
  startedAt: string
  stream: WriteStream
}

const SENSITIVE_OUTPUT_PATTERN =
  /\b(password|passphrase|secret|token|api[-_\s]?key|private[-_\s]?key|otp|verification code|sudo)\b[^\r\n]*[:?]?\s*$/i
const RECORDING_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/
const MAX_RECORDING_HEADER_BYTES = 64 * 1024
export const DEFAULT_RECORDING_CHUNK_BYTES = 64 * 1024
export const MAX_RECORDING_CHUNK_BYTES = 256 * 1024

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function formatDatePart(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function normalizeRecordingTheme(value: unknown): TerminalThemeSettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const theme = { ...defaultTerminalSettings.theme }
  for (const key of Object.keys(theme) as Array<keyof TerminalThemeSettings>) {
    if (typeof input[key] !== 'string') return null
    theme[key] = input[key]
  }
  return theme
}

function sanitizeError(_error: unknown): string {
  return 'The recording could not be written.'
}

function ensurePrivateDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  try {
    chmodSync(directory, 0o700)
  } catch {
    // Windows does not implement POSIX permission bits.
  }
}

function writeJsonAtomically(filePath: string, value: unknown): void {
  ensurePrivateDirectory(path.dirname(filePath))
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`)
  let descriptor: number | null = null
  try {
    descriptor = openSync(temporaryPath, 'wx', 0o600)
    writeFileSync(descriptor, JSON.stringify(value, null, 2), 'utf8')
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = null
    renameSync(temporaryPath, filePath)
    try {
      chmodSync(filePath, 0o600)
      const directoryDescriptor = openSync(path.dirname(filePath), 'r')
      try {
        fsyncSync(directoryDescriptor)
      } finally {
        closeSync(directoryDescriptor)
      }
    } catch {
      // Directory fsync and POSIX modes are not available on every platform.
    }
  } finally {
    if (descriptor !== null) closeSync(descriptor)
    rmSync(temporaryPath, { force: true })
  }
}

function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`)
}

function canonicalizePotentialPath(candidate: string): string {
  const resolved = path.resolve(candidate)
  let existingAncestor = resolved
  while (!existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor)
    if (parent === existingAncestor) return resolved
    existingAncestor = parent
  }
  return path.join(realpathSync(existingAncestor), path.relative(existingAncestor, resolved))
}

function safeBaseName(value: string | null): string | null {
  if (!value) return null
  const result = path.basename(value)
  return result && result !== path.sep ? result : null
}

async function readBoundedFirstLine(filePath: string, maxBytes: number): Promise<string | null> {
  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.allocUnsafe(maxBytes)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const newlineIndex = buffer.subarray(0, bytesRead).indexOf(0x0a)
    if (newlineIndex < 0) return null
    try {
      return new TextDecoder('utf-8', { fatal: true })
        .decode(buffer.subarray(0, newlineIndex))
        .replace(/\r$/, '')
    } catch {
      return null
    }
  } finally {
    await handle.close()
  }
}

export class TerminalRecordingService {
  private readonly activeRecordings = new Map<string, ActiveRecording>()
  private readonly failedStates = new Map<string, TerminalRecordingState>()
  private readonly options: RecordingServiceOptions
  private readonly recordingPathsById = new Map<string, string>()
  private readonly recordingRoots = new Set<string>()
  private readonly sessionMetadata = new Map<string, RecordingSessionMetadata>()

  constructor(options: RecordingServiceOptions) {
    this.options = options
    this.loadRootIndex()
    this.registerRoot(this.resolveRecordingRoot(options.getSettings().recording.directory), false)
    this.recoverInterruptedRecordings()
  }

  getState(sessionId: string): TerminalRecordingState {
    const active = this.activeRecordings.get(sessionId)
    return active ? this.toState(active) : this.failedStates.get(sessionId) ?? {
      bytesWritten: 0,
      errorMessage: null,
      eventCount: 0,
      recordingId: null,
      sessionId,
      startedAt: null,
      status: 'idle',
    }
  }

  updateSessionMetadata(sessionId: string, metadata: RecordingSessionMetadata): void {
    const next = { ...(this.sessionMetadata.get(sessionId) ?? {}), ...metadata }
    this.sessionMetadata.set(sessionId, next)
    const active = this.activeRecordings.get(sessionId)
    if (!active) return
    active.metadata = {
      ...active.metadata,
      color: next.color ?? active.metadata.color,
      cwd: typeof next.cwd === 'string' ? next.cwd : active.metadata.cwd,
      projectColor: next.projectColor ?? active.metadata.projectColor,
      projectEmoji: next.projectEmoji ?? active.metadata.projectEmoji,
      projectId: next.projectId ?? active.metadata.projectId,
      projectTitle: next.projectTitle ?? active.metadata.projectTitle,
      shell: next.shell ?? active.metadata.shell,
      title: next.title ?? active.metadata.title,
    }
    this.writeMetadata(active)
  }

  start(sessionId: string, metadata: RecordingSessionMetadata = {}): TerminalRecordingState {
    const existing = this.activeRecordings.get(sessionId)
    if (existing) {
      this.updateSessionMetadata(sessionId, metadata)
      return this.getState(sessionId)
    }
    const failed = this.failedStates.get(sessionId)
    if (failed) return failed

    this.updateSessionMetadata(sessionId, metadata)
    const terminalSettings = this.options.getSettings()
    const sessionMetadata = this.sessionMetadata.get(sessionId) ?? {}
    const now = new Date()
    const root = this.registerRoot(this.resolveRecordingRoot(terminalSettings.recording.directory), true)
    const dateDirectory = path.join(root, formatDatePart(now))
    ensurePrivateDirectory(dateDirectory)
    const recordingId = randomUUID()
    const castPath = path.join(dateDirectory, `${recordingId}.cast`)
    const metadataPath = path.join(dateDirectory, `${recordingId}.json`)
    const cols = Math.max(2, Math.floor(sessionMetadata.cols ?? 80))
    const rows = Math.max(1, Math.floor(sessionMetadata.rows ?? 24))
    const title = sessionMetadata.title || 'Terminal'
    const projectTitle = sessionMetadata.projectTitle ?? null
    const shell = sessionMetadata.shell ?? null
    const startedAt = now.toISOString()
    const stream = createWriteStream(castPath, { encoding: 'utf8', flags: 'wx', mode: 0o600 })
    const active: ActiveRecording = {
      bytesWritten: 0,
      castPath,
      cols,
      createdAtMs: now.getTime(),
      errorMessage: null,
      eventCount: 0,
      lastEventAtMs: now.getTime(),
      metadata: {
        version: 2,
        bytesWritten: 0,
        capturedInput: false,
        color: sessionMetadata.color ?? null,
        cols,
        cwd: sessionMetadata.cwd ?? null,
        durationMs: null,
        endedAt: null,
        errorMessage: null,
        eventCount: 0,
        exitCode: null,
        inputPolicy: 'none',
        projectColor: sessionMetadata.projectColor ?? null,
        projectEmoji: sessionMetadata.projectEmoji ?? null,
        projectId: sessionMetadata.projectId ?? null,
        projectTitle,
        recordingId,
        recordingState: 'recording',
        relativeCastPath: path.relative(root, castPath),
        rows,
        sensitiveInputPolicy: terminalSettings.recording.sensitiveInputPolicy,
        sessionId,
        shell,
        signal: null,
        startedAt,
        theme: resolveTerminalTheme(terminalSettings, sessionMetadata.color ?? sessionMetadata.projectColor),
        title,
      },
      metadataPath,
      recordingId,
      root,
      roundingCarryMs: 0,
      rows,
      sensitiveInputUntilMs: 0,
      sessionId,
      startedAt,
      stream,
    }
    stream.on('error', (error) => this.markFailed(active, error))
    this.activeRecordings.set(sessionId, active)
    this.recordingPathsById.set(recordingId, castPath)
    this.writeLine(active, JSON.stringify({
      version: 3,
      term: { cols, rows, type: 'xterm-256color' },
      timestamp: Math.floor(now.getTime() / 1000),
      title: projectTitle ? `${projectTitle} > ${title}` : title,
      env: { ...(shell ? { SHELL: shell } : {}), TERM: 'xterm-256color' },
    }))
    if (this.writeMetadata(active)) this.emitState(active)
    return this.getState(sessionId)
  }

  appendOutput(sessionId: string, data: string): void {
    const active = this.activeRecordings.get(sessionId)
    if (!active || active.errorMessage) return
    if (SENSITIVE_OUTPUT_PATTERN.test(data)) active.sensitiveInputUntilMs = Date.now() + 120_000
    this.appendEvent(active, 'o', data)
  }

  appendInput(sessionId: string, data: string): void {
    const active = this.activeRecordings.get(sessionId)
    if (!active || active.errorMessage) return
    const settings = this.options.getSettings().recording
    if (!settings.captureInput) return
    active.metadata.capturedInput = true
    active.metadata.inputPolicy = 'record-with-sensitive-filter'
    active.metadata.sensitiveInputPolicy = settings.sensitiveInputPolicy
    const filtered = this.filterInput(active, data)
    if (filtered) this.appendEvent(active, 'i', filtered)
    if (data.includes('\r') || data.includes('\n')) active.sensitiveInputUntilMs = 0
  }

  appendResize(sessionId: string, cols: number, rows: number): void {
    const active = this.activeRecordings.get(sessionId)
    if (!active || active.errorMessage) return
    const nextCols = Math.max(2, Math.floor(cols))
    const nextRows = Math.max(1, Math.floor(rows))
    if (active.cols === nextCols && active.rows === nextRows) return
    active.cols = nextCols
    active.rows = nextRows
    active.metadata.cols = nextCols
    active.metadata.rows = nextRows
    this.appendEvent(active, 'r', `${nextCols}x${nextRows}`)
  }

  finalize(
    sessionId: string,
    exitCode: number | null = null,
    signal: number | null = null,
    lifecycle: Exclude<RecordingLifecycle, 'recording'> = 'completed',
  ): TerminalRecordingState {
    const active = this.activeRecordings.get(sessionId)
    if (!active) return this.getState(sessionId)
    if (!active.errorMessage && exitCode !== null) this.appendEvent(active, 'x', String(exitCode))
    const endedAtMs = Date.now()
    active.metadata = {
      ...active.metadata,
      bytesWritten: active.bytesWritten,
      durationMs: Math.max(0, endedAtMs - active.createdAtMs),
      endedAt: new Date(endedAtMs).toISOString(),
      eventCount: active.eventCount,
      exitCode,
      recordingState: active.errorMessage ? 'failed' : lifecycle,
      signal: typeof signal === 'number' && signal > 0 ? signal : null,
    }
    this.writeMetadata(active)
    active.stream.end()
    this.activeRecordings.delete(sessionId)
    const state = this.toState(active, active.errorMessage ? 'failed' : 'idle')
    this.options.onStateChanged?.(state)
    return state
  }

  async listRecordings(): Promise<TerminalRecordingListItem[]> {
    this.registerRoot(this.resolveRecordingRoot(this.options.getSettings().recording.directory), false)
    const items: TerminalRecordingListItem[] = []
    const seenPaths = new Set<string>()
    for (const root of this.recordingRoots) {
      if (!existsSync(root)) continue
      const files = await this.walkRecordingFiles(root)
      for (const metadataPath of files.filter((candidate) => candidate.endsWith('.json'))) {
        const parsed = this.parsePersistedMetadata(metadataPath, root)
        if (!parsed) continue
        const castPath = this.castPathForMetadata(parsed, metadataPath, root)
        if (castPath && existsSync(castPath)) {
          try {
            const canonical = this.resolveExistingRecordingPath(castPath)
            seenPaths.add(canonical)
            this.recordingPathsById.set(parsed.recordingId, canonical)
          } catch {
            // A sidecar never authorizes a path outside a retained root.
          }
        }
        items.push(this.toListItem(parsed, castPath))
      }
      for (const castPath of files.filter((candidate) => candidate.endsWith('.cast'))) {
        let canonical: string
        try {
          canonical = this.resolveExistingRecordingPath(castPath)
        } catch {
          continue
        }
        if (seenPaths.has(canonical)) continue
        const fallback = await this.metadataFromCastHeader(canonical, root)
        if (fallback) {
          items.push(fallback)
          this.recordingPathsById.set(fallback.recordingId, canonical)
        }
      }
    }
    const uniqueItems = new Map<string, TerminalRecordingListItem>()
    for (const item of items) {
      if (!uniqueItems.has(item.recordingId)) uniqueItems.set(item.recordingId, item)
    }
    return [...uniqueItems.values()].sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
  }

  async readRecordingChunk(request: TerminalRecordingChunkRequest): Promise<TerminalRecordingChunk> {
    if (!request || typeof request !== 'object') throw new Error('A recording chunk request is required.')
    const recordingId = this.validateRecordingId(request.recordingId)
    const start = request.start ?? 0
    const maxBytes = request.maxBytes ?? DEFAULT_RECORDING_CHUNK_BYTES
    if (!Number.isSafeInteger(start) || start < 0) throw new Error('Recording chunk start must be a non-negative safe integer.')
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_RECORDING_CHUNK_BYTES) {
      throw new Error(`Recording chunk size must be between 1 and ${MAX_RECORDING_CHUNK_BYTES} bytes.`)
    }
    const castPath = await this.resolveRecordingPathById(recordingId)
    const handle = await open(castPath, 'r')
    try {
      const stats = await handle.stat()
      const totalSize = stats.size
      if (start > totalSize) throw new Error('Recording chunk start is beyond the end of the recording.')
      if (start > 0) {
        const preceding = Buffer.allocUnsafe(1)
        const result = await handle.read(preceding, 0, 1, start - 1)
        if (result.bytesRead !== 1 || preceding[0] !== 0x0a) {
          throw new Error('Recording chunk start must be an NDJSON record boundary.')
        }
      }
      if (start === totalSize) {
        return { content: '', eof: true, incompleteTail: false, nextOffset: start, recordingId, start, totalSize }
      }
      const requestedBytes = Math.min(maxBytes, totalSize - start)
      const buffer = Buffer.allocUnsafe(requestedBytes)
      const { bytesRead } = await handle.read(buffer, 0, requestedBytes, start)
      const bytes = buffer.subarray(0, bytesRead)
      const lastNewline = bytes.lastIndexOf(0x0a)
      if (lastNewline < 0) {
        if (start + bytesRead < totalSize) throw new Error(`An asciicast record exceeds the ${maxBytes} byte chunk limit.`)
        const active = this.isRecordingIdActive(recordingId)
        return {
          content: '',
          eof: !active,
          incompleteTail: true,
          nextOffset: active ? start : totalSize,
          recordingId,
          start,
          totalSize,
        }
      }
      const completeBytes = bytes.subarray(0, lastNewline + 1)
      let content: string
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(completeBytes)
      } catch {
        throw new Error('Recording contains invalid UTF-8.')
      }
      const nextOffset = start + completeBytes.length
      return {
        content,
        eof: nextOffset >= totalSize,
        incompleteTail: nextOffset < totalSize,
        nextOffset,
        recordingId,
        start,
        totalSize,
      }
    } finally {
      await handle.close()
    }
  }

  async deleteRecordingById(recordingId: string): Promise<void> {
    const validatedId = this.validateRecordingId(recordingId)
    if (this.isRecordingIdActive(validatedId)) {
      throw new Error('Stop the active recording before deleting it.')
    }
    const castPath = await this.resolveRecordingPathById(validatedId)
    this.assertRecordingPathIsInactive(castPath)
    rmSync(castPath, { force: true })
    rmSync(castPath.replace(/\.cast$/i, '.json'), { force: true })
    this.recordingPathsById.delete(recordingId)
  }

  async resolveRevealPathById(recordingId: string): Promise<string> {
    return this.resolveRecordingPathById(recordingId)
  }

  resolveRecordingRoot(rawDirectory: string): string {
    const home = this.options.getHomePath()
    const trimmed = rawDirectory.trim() || '~/Documents/TerminaySessions'
    if (trimmed === '~') return home
    if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) return path.join(home, trimmed.slice(2))
    return path.isAbsolute(trimmed) ? trimmed : path.join(home, trimmed)
  }

  private appendEvent(active: ActiveRecording, code: 'i' | 'o' | 'r' | 'x', data: string): void {
    const now = Date.now()
    const rawInterval = Math.max(0, now - active.lastEventAtMs + active.roundingCarryMs)
    const rounded = Math.round(rawInterval)
    active.roundingCarryMs = rawInterval - rounded
    active.lastEventAtMs = now
    this.writeLine(active, JSON.stringify([rounded / 1000, code, data]))
    active.eventCount += 1
    active.metadata.bytesWritten = active.bytesWritten
    active.metadata.eventCount = active.eventCount
    this.writeMetadata(active)
    this.emitState(active)
  }

  private castPathForMetadata(metadata: PersistedRecordingMetadata, metadataPath: string, root: string): string | null {
    const relative = metadata.relativeCastPath || `${path.basename(metadataPath, '.json')}.cast`
    if (path.isAbsolute(relative)) return null
    const candidate = path.resolve(root, relative)
    return isWithin(path.resolve(root), candidate) ? candidate : null
  }

  private emitState(active: ActiveRecording): void {
    this.options.onStateChanged?.(this.toState(active))
  }

  private filterInput(active: ActiveRecording, data: string): string {
    if (Date.now() > active.sensitiveInputUntilMs) return data
    if (active.metadata.sensitiveInputPolicy === 'drop') {
      return data.includes('\r') || data.includes('\n') ? data.replace(/[^\r\n]/g, '') : ''
    }
    return data.replace(/[ -~]/g, (character) => character === '\r' || character === '\n' ? character : '*')
  }

  private getLibraryIndexPath(): string {
    return this.options.getLibraryIndexPath?.()
      ?? path.join(this.options.getHomePath(), '.terminay', 'recording-roots.json')
  }

  private loadRootIndex(): void {
    try {
      const parsed = parseJsonObject(readFileSync(this.getLibraryIndexPath(), 'utf8'))
      if (!Array.isArray(parsed?.roots)) return
      for (const root of parsed.roots) {
        if (typeof root === 'string' && path.isAbsolute(root)) {
          this.recordingRoots.add(existsSync(root) ? realpathSync(root) : path.resolve(root))
        }
      }
    } catch {
      // The index is optional on first launch and recoverable by registering the current root.
    }
  }

  private registerRoot(rawRoot: string, create: boolean): string {
    const resolved = canonicalizePotentialPath(rawRoot)
    if (create) ensurePrivateDirectory(resolved)
    else if (existsSync(resolved)) {
      try {
        chmodSync(resolved, 0o700)
      } catch {
        // Windows does not implement POSIX permission bits.
      }
    }
    const canonical = existsSync(resolved) ? realpathSync(resolved) : resolved
    if (!this.recordingRoots.has(canonical)) {
      this.recordingRoots.add(canonical)
      this.persistRootIndex()
    }
    return canonical
  }

  private persistRootIndex(): void {
    writeJsonAtomically(this.getLibraryIndexPath(), { version: 1, roots: [...this.recordingRoots] })
  }

  private recoverInterruptedRecordings(): void {
    const endedAt = new Date().toISOString()
    for (const root of this.recordingRoots) {
      if (!existsSync(root)) continue
      const files = this.walkRecordingFilesSync(root)
      for (const metadataPath of files.filter((candidate) => candidate.endsWith('.json'))) {
        const metadata = this.parsePersistedMetadata(metadataPath, root)
        if (metadata?.recordingState !== 'recording') continue
        metadata.recordingState = 'interrupted'
        metadata.endedAt = endedAt
        metadata.durationMs = Math.max(0, Date.parse(endedAt) - Date.parse(metadata.startedAt))
        try {
          writeJsonAtomically(metadataPath, metadata)
        } catch {
          // Leave unreadable sidecars untouched; list still reports their last valid state.
        }
      }
      for (const castPath of files.filter((candidate) => candidate.endsWith('.cast'))) {
        const metadataPath = castPath.replace(/\.cast$/i, '.json')
        if (existsSync(metadataPath)) continue
        const metadata = this.metadataForOrphanedCast(castPath, root, endedAt)
        try {
          writeJsonAtomically(metadataPath, metadata)
        } catch {
          // The cast remains discoverable through its bounded header fallback.
        }
      }
    }
  }

  private parsePersistedMetadata(metadataPath: string, root: string): PersistedRecordingMetadata | null {
    let parsed: Record<string, unknown> | null
    try {
      parsed = parseJsonObject(readFileSync(metadataPath, 'utf8'))
    } catch {
      return null
    }
    if (!parsed) return null
    const legacyCastPath = typeof parsed.castPath === 'string' ? parsed.castPath : null
    const needsMigration = parsed.version !== 2 || typeof parsed.recordingId !== 'string' || typeof parsed.relativeCastPath !== 'string'
    const recordingId = typeof parsed.recordingId === 'string'
      ? parsed.recordingId
      : randomUUID()
    if (!RECORDING_ID_PATTERN.test(recordingId)) return null
    let relativeCastPath = typeof parsed.relativeCastPath === 'string'
      ? parsed.relativeCastPath
      : `${path.basename(metadataPath, '.json')}.cast`
    if (legacyCastPath) {
      const sibling = path.join(path.dirname(metadataPath), `${path.basename(metadataPath, '.json')}.cast`)
      relativeCastPath = path.relative(root, sibling)
    }
    const state: RecordingLifecycle =
      parsed.recordingState === 'recording' || parsed.recordingState === 'failed' ||
      parsed.recordingState === 'interrupted' || parsed.recordingState === 'completed'
        ? parsed.recordingState
        : 'completed'
    const metadata: PersistedRecordingMetadata = {
      version: 2,
      bytesWritten: Number(parsed.bytesWritten) || 0,
      capturedInput: parsed.capturedInput === true,
      color: typeof parsed.color === 'string' ? parsed.color : null,
      cols: Number(parsed.cols) || 80,
      cwd: typeof parsed.cwd === 'string' ? parsed.cwd : null,
      durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : null,
      endedAt: typeof parsed.endedAt === 'string' ? parsed.endedAt : null,
      errorMessage: typeof parsed.errorMessage === 'string' ? sanitizeError(parsed.errorMessage) : null,
      eventCount: Number(parsed.eventCount) || 0,
      exitCode: typeof parsed.exitCode === 'number' ? parsed.exitCode : null,
      inputPolicy: parsed.inputPolicy === 'record-with-sensitive-filter' ? parsed.inputPolicy : 'none',
      projectColor: typeof parsed.projectColor === 'string' ? parsed.projectColor : null,
      projectEmoji: typeof parsed.projectEmoji === 'string' ? parsed.projectEmoji : null,
      projectId: typeof parsed.projectId === 'string' ? parsed.projectId : null,
      projectTitle: typeof parsed.projectTitle === 'string' ? parsed.projectTitle : null,
      recordingId,
      recordingState: state,
      relativeCastPath,
      rows: Number(parsed.rows) || 24,
      sensitiveInputPolicy: parsed.sensitiveInputPolicy === 'mask' ? 'mask' : 'drop',
      sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : '',
      shell: typeof parsed.shell === 'string' ? parsed.shell : null,
      signal: typeof parsed.signal === 'number' && parsed.signal > 0 ? parsed.signal : null,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : new Date(0).toISOString(),
      theme: normalizeRecordingTheme(parsed.theme),
      title: typeof parsed.title === 'string' ? parsed.title : 'Terminal Recording',
    }
    if (needsMigration) {
      try {
        writeJsonAtomically(metadataPath, metadata)
      } catch {
        // Legacy recordings remain readable even if their sidecar cannot be upgraded.
      }
    }
    return metadata
  }

  private async metadataFromCastHeader(castPath: string, root: string): Promise<TerminalRecordingListItem | null> {
    const headerLine = await readBoundedFirstLine(castPath, MAX_RECORDING_HEADER_BYTES)
    const metadata = this.metadataForOrphanedCast(castPath, root, new Date().toISOString(), headerLine)
    try {
      writeJsonAtomically(castPath.replace(/\.cast$/i, '.json'), metadata)
    } catch {
      // The cast remains replayable for this process even if migration is read-only.
    }
    return this.toListItem(metadata, castPath)
  }

  private toListItem(metadata: PersistedRecordingMetadata, castPath: string | null): TerminalRecordingListItem {
    let castAvailable = false
    let bytesWritten = metadata.bytesWritten
    if (castPath && existsSync(castPath)) {
      try {
        const stats = statSync(castPath)
        castAvailable = stats.isFile()
        bytesWritten = stats.size
      } catch {
        // Report the sidecar even when its cast is unavailable.
      }
    }
    return {
      version: 2,
      bytesWritten,
      castAvailable,
      capturedInput: metadata.capturedInput,
      color: metadata.color,
      cols: metadata.cols,
      cwdLabel: safeBaseName(metadata.cwd),
      durationMs: metadata.durationMs,
      endedAt: metadata.endedAt,
      errorMessage: metadata.errorMessage ? sanitizeError(metadata.errorMessage) : null,
      eventCount: metadata.eventCount,
      exitCode: metadata.exitCode,
      inputPolicy: metadata.inputPolicy,
      projectColor: metadata.projectColor,
      projectEmoji: metadata.projectEmoji,
      projectId: metadata.projectId,
      projectTitle: metadata.projectTitle,
      recordingId: metadata.recordingId,
      recordingState: metadata.recordingState,
      rows: metadata.rows,
      sensitiveInputPolicy: metadata.sensitiveInputPolicy,
      sessionId: metadata.sessionId,
      shellName: safeBaseName(metadata.shell),
      signal: metadata.signal,
      startedAt: metadata.startedAt,
      theme: metadata.theme,
      title: metadata.title,
    }
  }

  private markFailed(active: ActiveRecording, error: unknown): void {
    const priorFailure = this.failedStates.get(active.sessionId)
    if (priorFailure?.recordingId === active.recordingId) return
    if (this.activeRecordings.get(active.sessionId) === active) {
      this.activeRecordings.delete(active.sessionId)
    }
    active.errorMessage = sanitizeError(error)
    const endedAtMs = Date.now()
    active.metadata = {
      ...active.metadata,
      bytesWritten: active.bytesWritten,
      durationMs: Math.max(0, endedAtMs - active.createdAtMs),
      endedAt: new Date(endedAtMs).toISOString(),
      errorMessage: active.errorMessage,
      eventCount: active.eventCount,
      recordingState: 'failed',
    }
    try {
      writeJsonAtomically(active.metadataPath, active.metadata)
    } catch {
      // The original recording failure is the useful state.
    }
    if (!active.stream.destroyed) active.stream.destroy()
    const state = this.toState(active, 'failed')
    this.failedStates.set(active.sessionId, state)
    this.options.onStateChanged?.(state)
  }

  private resolveExistingRecordingPath(candidatePath: string): string {
    let canonical: string
    try {
      canonical = realpathSync(path.resolve(candidatePath))
    } catch {
      throw new Error('Recording file does not exist.')
    }
    if (!canonical.endsWith('.cast')) throw new Error('Recording file does not exist.')
    const authorized = [...this.recordingRoots].some((root) => {
      try {
        return isWithin(realpathSync(root), canonical)
      } catch {
        return false
      }
    })
    if (!authorized) throw new Error('Recording file is outside the recordings library.')
    return canonical
  }

  private assertRecordingPathIsInactive(castPath: string): void {
    const canonical = realpathSync(castPath)
    for (const active of this.activeRecordings.values()) {
      try {
        if (realpathSync(active.castPath) === canonical) throw new Error('Stop the active recording before deleting it.')
      } catch (error) {
        if (error instanceof Error && /Stop the active/.test(error.message)) throw error
      }
    }
  }

  private isRecordingIdActive(recordingId: string): boolean {
    return [...this.activeRecordings.values()].some((active) => active.recordingId === recordingId)
  }

  private async resolveRecordingPathById(rawRecordingId: string): Promise<string> {
    const recordingId = this.validateRecordingId(rawRecordingId)
    const active = [...this.activeRecordings.values()].find((candidate) => candidate.recordingId === recordingId)
    if (active) return this.resolveExistingRecordingPath(active.castPath)
    const indexed = this.recordingPathsById.get(recordingId)
    if (indexed) {
      try {
        return this.resolveExistingRecordingPath(indexed)
      } catch {
        this.recordingPathsById.delete(recordingId)
      }
    }
    await this.listRecordings()
    const discovered = this.recordingPathsById.get(recordingId)
    if (!discovered) throw new Error('Recording does not exist.')
    return this.resolveExistingRecordingPath(discovered)
  }

  private validateRecordingId(recordingId: string): string {
    if (typeof recordingId !== 'string' || !RECORDING_ID_PATTERN.test(recordingId)) {
      throw new Error('Recording id is invalid.')
    }
    return recordingId
  }

  private toState(active: ActiveRecording, status?: TerminalRecordingState['status']): TerminalRecordingState {
    return {
      bytesWritten: active.bytesWritten,
      errorMessage: active.errorMessage,
      eventCount: active.eventCount,
      recordingId: active.recordingId,
      sessionId: active.sessionId,
      startedAt: active.startedAt,
      status: status ?? (active.errorMessage ? 'failed' : 'recording'),
    }
  }

  private async walkRecordingFiles(root: string): Promise<string[]> {
    const entries = await readdir(root, { withFileTypes: true })
    const files: string[] = []
    for (const entry of entries) {
      const entryPath = path.join(root, entry.name)
      if (entry.isDirectory()) files.push(...await this.walkRecordingFiles(entryPath))
      else if (entry.isFile() && (entry.name.endsWith('.cast') || entry.name.endsWith('.json'))) files.push(entryPath)
    }
    return files
  }

  private walkRecordingFilesSync(root: string): string[] {
    const files: string[] = []
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const entryPath = path.join(root, entry.name)
      if (entry.isDirectory()) files.push(...this.walkRecordingFilesSync(entryPath))
      else if (entry.isFile() && (entry.name.endsWith('.cast') || entry.name.endsWith('.json'))) files.push(entryPath)
    }
    return files
  }

  private writeLine(active: ActiveRecording, line: string): void {
    const text = `${line}\n`
    active.bytesWritten += Buffer.byteLength(text, 'utf8')
    active.stream.write(text)
  }

  private writeMetadata(active: ActiveRecording): boolean {
    try {
      (this.options.writeMetadataAtomically ?? writeJsonAtomically)(active.metadataPath, active.metadata)
      return true
    } catch (error) {
      this.markFailed(active, error)
      return false
    }
  }

  private metadataForOrphanedCast(
    castPath: string,
    root: string,
    endedAt: string,
    knownHeaderLine?: string | null,
  ): PersistedRecordingMetadata {
    let headerLine = knownHeaderLine
    if (headerLine === undefined) {
      const descriptor = openSync(castPath, 'r')
      try {
        const buffer = Buffer.allocUnsafe(MAX_RECORDING_HEADER_BYTES)
        const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0)
        const newlineIndex = buffer.subarray(0, bytesRead).indexOf(0x0a)
        headerLine = newlineIndex < 0
          ? null
          : new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, newlineIndex)).replace(/\r$/, '')
      } catch {
        headerLine = null
      } finally {
        closeSync(descriptor)
      }
    }
    const header = headerLine === null ? null : parseJsonObject(headerLine)
    const term = typeof header?.term === 'object' && header.term !== null ? header.term as Record<string, unknown> : {}
    const stats = statSync(castPath)
    const fileId = path.basename(castPath, '.cast')
    const recordingId = RECORDING_ID_PATTERN.test(fileId) ? fileId : randomUUID()
    const startedAtMs = (Number(header?.timestamp) || stats.birthtimeMs / 1000) * 1000
    return {
      version: 2,
      bytesWritten: stats.size,
      capturedInput: false,
      color: null,
      cols: Number(term.cols) || 80,
      cwd: null,
      durationMs: Math.max(0, Date.parse(endedAt) - startedAtMs),
      endedAt,
      errorMessage: null,
      eventCount: 0,
      exitCode: null,
      inputPolicy: 'none',
      projectColor: null,
      projectEmoji: null,
      projectId: null,
      projectTitle: null,
      recordingId,
      recordingState: 'interrupted',
      relativeCastPath: path.relative(root, castPath),
      rows: Number(term.rows) || 24,
      sensitiveInputPolicy: 'drop',
      sessionId: '',
      shell: null,
      signal: null,
      startedAt: new Date(startedAtMs).toISOString(),
      theme: null,
      title: typeof header?.title === 'string' ? header.title : 'Incomplete terminal recording',
    }
  }
}
