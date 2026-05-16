import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, type WriteStream } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { defaultTerminalSettings, resolveTerminalTheme } from '../../src/terminalSettings'
import type { TerminalSettings, TerminalThemeSettings } from '../../src/types/settings'
import type {
  TerminalRecordingCast,
  TerminalRecordingListItem,
  TerminalRecordingMetadata,
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
  getSettings: () => TerminalSettings
  onStateChanged?: (state: TerminalRecordingState) => void
}

type ActiveRecording = {
  bytesWritten: number
  castPath: string
  cols: number
  createdAtMs: number
  errorMessage: string | null
  eventCount: number
  lastEventAtMs: number
  metadata: TerminalRecordingMetadata
  metadataPath: string
  recordingId: string
  roundingCarryMs: number
  rows: number
  sensitiveInputUntilMs: number
  sessionId: string
  startedAt: string
  stream: WriteStream
}

const SENSITIVE_OUTPUT_PATTERN =
  /\b(password|passphrase|secret|token|api[-_\s]?key|private[-_\s]?key|otp|verification code|sudo)\b[^\r\n]*[:?]?\s*$/i

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function formatDatePart(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function formatTimePart(date: Date): string {
  return `${pad2(date.getHours())}-${pad2(date.getMinutes())}-${pad2(date.getSeconds())}`
}

function sanitizeFilePart(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .replace(/[^\w\s.-]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/[-.]{2,}/g, '-')
    .slice(0, 48)
    .replace(/^[-.]+|[-.]+$/g, '')

  return sanitized || fallback
}

function buildDisplayTitle(projectTitle: string | null | undefined, title: string): string {
  return projectTitle ? `${projectTitle} > ${title}` : title
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function normalizeRecordingTheme(value: unknown): TerminalThemeSettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const input = value as Record<string, unknown>
  const theme = { ...defaultTerminalSettings.theme }

  for (const key of Object.keys(theme) as Array<keyof TerminalThemeSettings>) {
    const nextValue = input[key]
    if (typeof nextValue !== 'string') {
      return null
    }

    theme[key] = nextValue
  }

  return theme
}

function resolveRecordingTheme(settings: TerminalSettings, metadata: RecordingSessionMetadata): TerminalThemeSettings {
  return resolveTerminalTheme(settings, metadata.color ?? metadata.projectColor)
}

function parseRecordingMetadata(value: string, metadataPath: string | null): TerminalRecordingListItem | null {
  const parsed = parseJsonObject(value)
  if (!parsed || parsed.version !== 1 || typeof parsed.castPath !== 'string') {
    return null
  }

  const metadata = parsed as TerminalRecordingMetadata
  const theme = normalizeRecordingTheme(parsed.theme)
  return {
    bytesWritten: Number(metadata.bytesWritten) || 0,
    capturedInput: metadata.capturedInput === true,
    castPath: metadata.castPath,
    color: typeof metadata.color === 'string' ? metadata.color : null,
    cols: Number(metadata.cols) || 80,
    cwd: typeof metadata.cwd === 'string' ? metadata.cwd : null,
    durationMs: typeof metadata.durationMs === 'number' ? metadata.durationMs : null,
    endedAt: typeof metadata.endedAt === 'string' ? metadata.endedAt : null,
    errorMessage: typeof metadata.errorMessage === 'string' ? metadata.errorMessage : null,
    eventCount: Number(metadata.eventCount) || 0,
    exitCode: typeof metadata.exitCode === 'number' ? metadata.exitCode : null,
    inputPolicy: metadata.inputPolicy === 'record-with-sensitive-filter' ? metadata.inputPolicy : 'none',
    metadataPath,
    projectColor: typeof metadata.projectColor === 'string' ? metadata.projectColor : null,
    projectEmoji: typeof metadata.projectEmoji === 'string' ? metadata.projectEmoji : null,
    projectId: typeof metadata.projectId === 'string' ? metadata.projectId : null,
    projectTitle: typeof metadata.projectTitle === 'string' ? metadata.projectTitle : null,
    recordingId: typeof metadata.recordingId === 'string' ? metadata.recordingId : path.basename(metadata.castPath, '.cast'),
    recordingState:
      metadata.recordingState === 'recording' || metadata.recordingState === 'failed'
        ? metadata.recordingState
        : 'stopped',
    rows: Number(metadata.rows) || 24,
    sensitiveInputPolicy: metadata.sensitiveInputPolicy === 'mask' ? metadata.sensitiveInputPolicy : 'drop',
    sessionId: typeof metadata.sessionId === 'string' ? metadata.sessionId : '',
    shell: typeof metadata.shell === 'string' ? metadata.shell : null,
    startedAt: typeof metadata.startedAt === 'string' ? metadata.startedAt : new Date(0).toISOString(),
    theme,
    title: typeof metadata.title === 'string' ? metadata.title : 'Terminal Recording',
    version: 1,
  }
}

function metadataFromCastHeader(castPath: string): TerminalRecordingListItem | null {
  let headerLine = ''
  try {
    const fd = readFileSync(castPath, 'utf8')
    headerLine = fd.split(/\r?\n/, 1)[0] ?? ''
  } catch {
    return null
  }

  const header = parseJsonObject(headerLine)
  const term = typeof header?.term === 'object' && header.term !== null ? (header.term as Record<string, unknown>) : {}
  const stats = statSync(castPath)
  const timestamp = typeof header?.timestamp === 'number' ? header.timestamp * 1000 : stats.birthtimeMs
  const startedAt = new Date(timestamp).toISOString()

  return {
    bytesWritten: stats.size,
    capturedInput: false,
    castPath,
    color: null,
    cols: Number(term.cols) || 80,
    cwd: null,
    durationMs: null,
    endedAt: null,
    errorMessage: null,
    eventCount: 0,
    exitCode: null,
    inputPolicy: 'none',
    metadataPath: null,
    projectColor: null,
    projectEmoji: null,
    projectId: null,
    projectTitle: null,
    recordingId: path.basename(castPath, '.cast'),
    recordingState: 'stopped',
    rows: Number(term.rows) || 24,
    sensitiveInputPolicy: 'drop',
    sessionId: '',
    shell: null,
    startedAt,
    theme: null,
    title: typeof header?.title === 'string' ? header.title : path.basename(castPath, '.cast'),
    version: 1,
  }
}

export class TerminalRecordingService {
  private readonly activeRecordings = new Map<string, ActiveRecording>()
  private readonly options: RecordingServiceOptions
  private readonly sessionMetadata = new Map<string, RecordingSessionMetadata>()

  constructor(options: RecordingServiceOptions) {
    this.options = options
  }

  getState(sessionId: string): TerminalRecordingState {
    const active = this.activeRecordings.get(sessionId)
    if (!active) {
      return {
        bytesWritten: 0,
        castPath: null,
        errorMessage: null,
        eventCount: 0,
        metadataPath: null,
        recordingId: null,
        sessionId,
        startedAt: null,
        status: 'idle',
      }
    }

    return this.toState(active)
  }

  updateSessionMetadata(sessionId: string, metadata: RecordingSessionMetadata): void {
    const current = this.sessionMetadata.get(sessionId) ?? {}
    const next = {
      ...current,
      ...metadata,
    }
    this.sessionMetadata.set(sessionId, next)

    const active = this.activeRecordings.get(sessionId)
    if (!active) {
      return
    }

    active.metadata = {
      ...active.metadata,
      cwd: typeof next.cwd === 'string' ? next.cwd : active.metadata.cwd,
      color: next.color ?? active.metadata.color,
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
      return this.toState(existing)
    }

    this.updateSessionMetadata(sessionId, metadata)
    const terminalSettings = this.options.getSettings()
    const settings = terminalSettings.recording
    const sessionMetadata = this.sessionMetadata.get(sessionId) ?? {}
    const now = new Date()
    const startedAt = now.toISOString()
    const recordingRoot = this.resolveRecordingRoot(settings.directory)
    const dateDir = path.join(recordingRoot, formatDatePart(now))
    mkdirSync(dateDir, { recursive: true })

    const title = sessionMetadata.title || 'Terminal'
    const projectTitle = sessionMetadata.projectTitle || null
    const displayTitle = buildDisplayTitle(projectTitle, title)
    const baseName = [
      formatTimePart(now),
      sanitizeFilePart(projectTitle ?? 'No Project', 'no-project'),
      sanitizeFilePart(title, 'terminal'),
      sessionId.slice(0, 8),
    ].join('__')
    const castPath = this.resolveCollisionPath(dateDir, baseName, '.cast')
    const metadataPath = castPath.replace(/\.cast$/i, '.json')
    const recordingId = path.basename(castPath, '.cast')
    const cols = Math.max(2, Math.floor(sessionMetadata.cols ?? 80))
    const rows = Math.max(1, Math.floor(sessionMetadata.rows ?? 24))
    const shell = sessionMetadata.shell ?? null
    const stream = createWriteStream(castPath, { encoding: 'utf8', flags: 'wx' })
    const header = {
      version: 3,
      term: {
        cols,
        rows,
        type: 'xterm-256color',
      },
      timestamp: Math.floor(now.getTime() / 1000),
      title: displayTitle,
      env: {
        ...(shell ? { SHELL: shell } : {}),
        TERM: 'xterm-256color',
      },
    }

    const active: ActiveRecording = {
      bytesWritten: 0,
      castPath,
      cols,
      createdAtMs: now.getTime(),
      errorMessage: null,
      eventCount: 0,
      lastEventAtMs: now.getTime(),
      metadata: {
        version: 1,
        bytesWritten: 0,
        capturedInput: settings.captureInput,
        castPath,
        color: sessionMetadata.color ?? null,
        cols,
        cwd: sessionMetadata.cwd ?? null,
        durationMs: null,
        endedAt: null,
        errorMessage: null,
        eventCount: 0,
        exitCode: null,
        inputPolicy: settings.captureInput ? 'record-with-sensitive-filter' : 'none',
        projectColor: sessionMetadata.projectColor ?? null,
        projectEmoji: sessionMetadata.projectEmoji ?? null,
        projectId: sessionMetadata.projectId ?? null,
        projectTitle,
        recordingId,
        recordingState: 'recording',
        rows,
        sensitiveInputPolicy: settings.sensitiveInputPolicy,
        sessionId,
        shell,
        startedAt,
        theme: resolveRecordingTheme(terminalSettings, sessionMetadata),
        title,
      },
      metadataPath,
      recordingId,
      roundingCarryMs: 0,
      rows,
      sensitiveInputUntilMs: 0,
      sessionId,
      startedAt,
      stream,
    }

    stream.on('error', (error) => {
      this.markFailed(sessionId, error instanceof Error ? error.message : String(error))
    })

    this.activeRecordings.set(sessionId, active)
    this.writeLine(active, JSON.stringify(header))
    this.writeMetadata(active)
    this.emitState(active)
    return this.toState(active)
  }

  appendOutput(sessionId: string, data: string): void {
    const active = this.activeRecordings.get(sessionId)
    if (!active || active.errorMessage) {
      return
    }

    if (SENSITIVE_OUTPUT_PATTERN.test(data)) {
      active.sensitiveInputUntilMs = Date.now() + 120_000
    }

    this.appendEvent(active, 'o', data)
  }

  appendInput(sessionId: string, data: string): void {
    const active = this.activeRecordings.get(sessionId)
    if (!active || active.errorMessage || !active.metadata.capturedInput) {
      return
    }

    const filtered = this.filterInput(active, data)
    if (!filtered) {
      return
    }

    this.appendEvent(active, 'i', filtered)

    if (data.includes('\r') || data.includes('\n')) {
      active.sensitiveInputUntilMs = 0
    }
  }

  appendResize(sessionId: string, cols: number, rows: number): void {
    const active = this.activeRecordings.get(sessionId)
    if (!active || active.errorMessage) {
      return
    }

    const nextCols = Math.max(2, Math.floor(cols))
    const nextRows = Math.max(1, Math.floor(rows))
    if (active.cols === nextCols && active.rows === nextRows) {
      return
    }

    active.cols = nextCols
    active.rows = nextRows
    active.metadata.cols = nextCols
    active.metadata.rows = nextRows
    this.appendEvent(active, 'r', `${nextCols}x${nextRows}`)
  }

  finalize(sessionId: string, exitCode: number | null = null): TerminalRecordingState {
    const active = this.activeRecordings.get(sessionId)
    if (!active) {
      return this.getState(sessionId)
    }

    if (!active.errorMessage && exitCode !== null) {
      this.appendEvent(active, 'x', String(exitCode))
    }

    const endedAtMs = Date.now()
    active.metadata = {
      ...active.metadata,
      bytesWritten: active.bytesWritten,
      durationMs: Math.max(0, endedAtMs - active.createdAtMs),
      endedAt: new Date(endedAtMs).toISOString(),
      eventCount: active.eventCount,
      exitCode,
      recordingState: active.errorMessage ? 'failed' : 'stopped',
    }
    this.writeMetadata(active)
    active.stream.end()
    this.activeRecordings.delete(sessionId)
    const state = this.toState(active, active.errorMessage ? 'failed' : 'idle')
    this.options.onStateChanged?.(state)
    return state
  }

  async listRecordings(): Promise<TerminalRecordingListItem[]> {
    const root = this.resolveRecordingRoot(this.options.getSettings().recording.directory)
    if (!existsSync(root)) {
      return []
    }

    const files = await this.walkRecordingFiles(root)
    const metadataItems: TerminalRecordingListItem[] = []
    const metadataCastPaths = new Set<string>()

    for (const filePath of files.filter((candidate) => candidate.endsWith('.json'))) {
      try {
        const item = parseRecordingMetadata(await readFile(filePath, 'utf8'), filePath)
        if (item) {
          metadataItems.push(item)
          metadataCastPaths.add(item.castPath)
        }
      } catch {
        // Ignore unreadable metadata files; a matching cast can still be parsed.
      }
    }

    for (const filePath of files.filter((candidate) => candidate.endsWith('.cast'))) {
      if (metadataCastPaths.has(filePath)) {
        continue
      }

      const item = metadataFromCastHeader(filePath)
      if (item) {
        metadataItems.push(item)
      }
    }

    return metadataItems.sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
  }

  async readRecording(castPath: string): Promise<TerminalRecordingCast> {
    const resolvedCastPath = this.resolveExistingRecordingPath(castPath)
    const metadataPath = resolvedCastPath.replace(/\.cast$/i, '.json')
    let metadata: TerminalRecordingMetadata | null = null
    if (existsSync(metadataPath)) {
      const item = parseRecordingMetadata(await readFile(metadataPath, 'utf8'), metadataPath)
      if (item) {
        const { metadataPath: _metadataPath, ...recordingMetadata } = item
        metadata = recordingMetadata
      }
    }

    return {
      content: await readFile(resolvedCastPath, 'utf8'),
      metadata,
      path: resolvedCastPath,
    }
  }

  deleteRecording(castPath: string): void {
    const resolvedCastPath = this.resolveExistingRecordingPath(castPath)
    const metadataPath = resolvedCastPath.replace(/\.cast$/i, '.json')
    rmSync(resolvedCastPath, { force: true })
    rmSync(metadataPath, { force: true })
  }

  resolveRecordingRoot(rawDirectory: string): string {
    const home = this.options.getHomePath()
    const trimmed = rawDirectory.trim() || '~/Documents/TerminaySessions'
    if (trimmed === '~') {
      return home
    }

    if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
      return path.join(home, trimmed.slice(2))
    }

    return path.isAbsolute(trimmed) ? trimmed : path.join(home, trimmed)
  }

  private appendEvent(active: ActiveRecording, code: 'i' | 'o' | 'r' | 'x', data: string): void {
    const now = Date.now()
    const rawIntervalMs = Math.max(0, now - active.lastEventAtMs + active.roundingCarryMs)
    const roundedIntervalMs = Math.round(rawIntervalMs)
    active.roundingCarryMs = rawIntervalMs - roundedIntervalMs
    active.lastEventAtMs = now
    this.writeLine(active, JSON.stringify([roundedIntervalMs / 1000, code, data]))
    active.eventCount += 1
    active.metadata.bytesWritten = active.bytesWritten
    active.metadata.eventCount = active.eventCount
    this.writeMetadata(active)
    this.emitState(active)
  }

  private emitState(active: ActiveRecording): void {
    this.options.onStateChanged?.(this.toState(active))
  }

  private filterInput(active: ActiveRecording, data: string): string {
    if (Date.now() > active.sensitiveInputUntilMs) {
      return data
    }

    if (active.metadata.sensitiveInputPolicy === 'drop') {
      return data.includes('\r') || data.includes('\n') ? data.replace(/[^\r\n]/g, '') : ''
    }

    return data.replace(/[ -~]/g, (char) => (char === '\r' || char === '\n' ? char : '*'))
  }

  private markFailed(sessionId: string, message: string): void {
    const active = this.activeRecordings.get(sessionId)
    if (!active) {
      return
    }

    active.errorMessage = message
    active.metadata.errorMessage = message
    active.metadata.recordingState = 'failed'
    this.writeMetadata(active)
    this.emitState(active)
  }

  private resolveCollisionPath(directory: string, baseName: string, extension: string): string {
    let candidate = path.join(directory, `${baseName}${extension}`)
    let index = 2
    while (existsSync(candidate)) {
      candidate = path.join(directory, `${baseName}-${index}${extension}`)
      index += 1
    }
    return candidate
  }

  private resolveExistingRecordingPath(castPath: string): string {
    const resolved = path.resolve(castPath)
    const root = path.resolve(this.resolveRecordingRoot(this.options.getSettings().recording.directory))
    if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== root) {
      throw new Error('Recording path is outside the configured recordings directory.')
    }

    if (!existsSync(resolved) || !resolved.endsWith('.cast')) {
      throw new Error('Recording file does not exist.')
    }

    return resolved
  }

  private toState(active: ActiveRecording, overrideStatus?: TerminalRecordingState['status']): TerminalRecordingState {
    return {
      bytesWritten: active.bytesWritten,
      castPath: active.castPath,
      errorMessage: active.errorMessage,
      eventCount: active.eventCount,
      metadataPath: active.metadataPath,
      recordingId: active.recordingId,
      sessionId: active.sessionId,
      startedAt: active.startedAt,
      status: overrideStatus ?? (active.errorMessage ? 'failed' : 'recording'),
    }
  }

  private async walkRecordingFiles(root: string): Promise<string[]> {
    const entries = await readdir(root, { withFileTypes: true })
    const files: string[] = []

    for (const entry of entries) {
      const entryPath = path.join(root, entry.name)
      if (entry.isDirectory()) {
        files.push(...await this.walkRecordingFiles(entryPath))
        continue
      }

      if (entry.isFile() && (entry.name.endsWith('.cast') || entry.name.endsWith('.json'))) {
        files.push(entryPath)
      }
    }

    return files
  }

  private writeLine(active: ActiveRecording, line: string): void {
    const text = `${line}\n`
    active.bytesWritten += Buffer.byteLength(text, 'utf8')
    active.stream.write(text)
  }

  private writeMetadata(active: ActiveRecording): void {
    try {
      writeFileSync(active.metadataPath, JSON.stringify(active.metadata, null, 2))
    } catch (error) {
      active.errorMessage = error instanceof Error ? error.message : String(error)
    }
  }
}
