import { SerializeAddon } from '@xterm/addon-serialize'
import { Terminal as HeadlessTerminal } from '@xterm/headless'
import type { TerminalRecordingChunk } from './types/terminay'

export type ReplayEvent = {
  code: string
  data: string
  time: number
}

export type ReplayCheckpoint = {
  cols: number
  nextOffset: number
  rows: number
  state: string
  time: number
}

export type ReplayIndex = {
  checkpoints: ReplayCheckpoint[]
  cols: number
  duration: number
  malformedRecordCount: number
  recordingId: string
  rows: number
  title: string
  truncatedTail: boolean
}

export type ReplayCursor = {
  eof: boolean
  nextOffset: number
  parseTime: number
  pendingEvents: ReplayEvent[]
  recordingId: string
  time: number
}

type ChunkReader = (request: {
  maxBytes?: number
  recordingId: string
  start?: number
}) => Promise<TerminalRecordingChunk>

type ReplayTerminal = {
  reset: () => void
  resize: (cols: number, rows: number) => void
  write: (data: string, callback?: () => void) => void
}

const INDEX_CHUNK_BYTES = 256 * 1024
const CHECKPOINT_SCROLLBACK_ROWS = 200
const MAX_CHECKPOINTS = 32
const MAX_CHECKPOINT_STATE_BYTES = 512 * 1024
const INITIAL_CHECKPOINT_SECONDS = 10
const INITIAL_CHECKPOINT_BYTES = 1024 * 1024
const MAX_REPLAY_COLS = 1_000
const MAX_REPLAY_ROWS = 500

function abortIfRequested(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException('Replay loading was canceled.', 'AbortError')
  }
}

function clampCols(value: unknown): number {
  return Math.min(MAX_REPLAY_COLS, Math.max(2, Math.floor(Number(value) || 80)))
}

function clampRows(value: unknown): number {
  return Math.min(MAX_REPLAY_ROWS, Math.max(1, Math.floor(Number(value) || 24)))
}

function parseHeader(line: string): { cols: number; rows: number; title: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    throw new Error('The recording header is malformed.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The recording header is malformed.')
  }

  const header = parsed as { term?: { cols?: unknown; rows?: unknown }; title?: unknown; version?: unknown }
  if (header.version !== 3) {
    throw new Error('The recording uses an unsupported asciicast version.')
  }
  return {
    cols: clampCols(header.term?.cols),
    rows: clampRows(header.term?.rows),
    title: typeof header.title === 'string' ? header.title : 'Terminal Recording',
  }
}

function parseEvent(line: string, previousTime: number): ReplayEvent | null {
  if (!line || line.startsWith('#')) {
    return null
  }

  let tuple: unknown
  try {
    tuple = JSON.parse(line)
  } catch {
    return null
  }
  if (!Array.isArray(tuple) || tuple.length < 3) {
    return null
  }

  const [interval, code, data] = tuple
  if (typeof interval !== 'number' || !Number.isFinite(interval) || typeof code !== 'string' || typeof data !== 'string') {
    return null
  }
  return {
    code,
    data,
    time: previousTime + Math.max(0, interval),
  }
}

function completeLines(content: string): Array<{ byteLength: number; line: string }> {
  if (!content) {
    return []
  }
  const encoder = new TextEncoder()
  return content
    .split('\n')
    .slice(0, -1)
    .map((line) => {
      const normalized = line.replace(/\r$/, '')
      return {
        byteLength: encoder.encode(`${line}\n`).byteLength,
        line: normalized,
      }
    })
}

function writeAsync(terminal: ReplayTerminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve))
}

async function applyReplayEvent(terminal: ReplayTerminal, event: ReplayEvent): Promise<void> {
  if (event.code === 'o') {
    await writeAsync(terminal, event.data)
    return
  }
  if (event.code === 'r') {
    const [cols, rows] = event.data.split('x').map((part) => Number(part))
    if (Number.isFinite(cols) && Number.isFinite(rows)) {
      terminal.resize(clampCols(cols), clampRows(rows))
    }
  }
}

async function queueIndexEvent(terminal: ReplayTerminal, event: ReplayEvent): Promise<void> {
  if (event.code === 'o') {
    terminal.write(event.data)
    return
  }
  if (event.code === 'r') {
    await writeAsync(terminal, '')
    const [cols, rows] = event.data.split('x').map((part) => Number(part))
    if (Number.isFinite(cols) && Number.isFinite(rows)) {
      terminal.resize(clampCols(cols), clampRows(rows))
    }
  }
}

function compactCheckpoints(checkpoints: ReplayCheckpoint[]): ReplayCheckpoint[] {
  if (checkpoints.length < MAX_CHECKPOINTS) {
    return checkpoints
  }
  return checkpoints.filter((_checkpoint, index) => index === 0 || index % 2 === 0)
}

export async function buildReplayIndex(
  recordingId: string,
  readChunk: ChunkReader,
  signal: AbortSignal,
): Promise<ReplayIndex> {
  abortIfRequested(signal)
  let chunk = await readChunk({ maxBytes: INDEX_CHUNK_BYTES, recordingId, start: 0 })
  abortIfRequested(signal)
  let nextOffset = chunk.nextOffset
  let lines = completeLines(chunk.content)
  const first = lines.shift()
  if (!first) {
    throw new Error('The recording has no complete asciicast header.')
  }
  const header = parseHeader(first.line)
  const terminal = new HeadlessTerminal({
    allowProposedApi: true,
    cols: header.cols,
    rows: header.rows,
    scrollback: CHECKPOINT_SCROLLBACK_ROWS,
  })
  const serializeAddon = new SerializeAddon()
  terminal.loadAddon(serializeAddon as never)

  let lineOffset = first.byteLength
  let eventTime = 0
  let malformedRecordCount = 0
  let checkpointSeconds = INITIAL_CHECKPOINT_SECONDS
  let checkpointBytes = INITIAL_CHECKPOINT_BYTES
  let nextCheckpointTime = checkpointSeconds
  let nextCheckpointOffset = lineOffset + checkpointBytes
  let checkpoints: ReplayCheckpoint[] = [
    {
      cols: header.cols,
      nextOffset: lineOffset,
      rows: header.rows,
      state: '',
      time: 0,
    },
  ]

  try {
    while (true) {
      for (const entry of lines) {
        abortIfRequested(signal)
        lineOffset += entry.byteLength
        if (!entry.line || entry.line.startsWith('#')) {
          continue
        }
        const event = parseEvent(entry.line, eventTime)
        if (!event) {
          malformedRecordCount += 1
          continue
        }
        eventTime = event.time
        await queueIndexEvent(terminal, event)

        if (eventTime >= nextCheckpointTime || lineOffset >= nextCheckpointOffset) {
          abortIfRequested(signal)
          await writeAsync(terminal, '')
          const state = serializeAddon.serialize({ scrollback: CHECKPOINT_SCROLLBACK_ROWS })
          if (new TextEncoder().encode(state).byteLength <= MAX_CHECKPOINT_STATE_BYTES) {
            checkpoints.push({
              cols: terminal.cols,
              nextOffset: lineOffset,
              rows: terminal.rows,
              state,
              time: eventTime,
            })
          }
          if (checkpoints.length >= MAX_CHECKPOINTS) {
            checkpoints = compactCheckpoints(checkpoints)
            checkpointSeconds *= 2
            checkpointBytes *= 2
          }
          nextCheckpointTime = eventTime + checkpointSeconds
          nextCheckpointOffset = lineOffset + checkpointBytes
        }
      }

      if (chunk.eof) {
        return {
          checkpoints,
          cols: header.cols,
          duration: eventTime,
          malformedRecordCount,
          recordingId,
          rows: header.rows,
          title: header.title,
          truncatedTail: chunk.incompleteTail,
        }
      }
      if (chunk.nextOffset <= (chunk.start ?? 0)) {
        if (chunk.incompleteTail) {
          return {
            checkpoints,
            cols: header.cols,
            duration: eventTime,
            malformedRecordCount,
            recordingId,
            rows: header.rows,
            title: header.title,
            truncatedTail: true,
          }
        }
        throw new Error('The recording reader made no progress.')
      }

      chunk = await readChunk({
        maxBytes: INDEX_CHUNK_BYTES,
        recordingId,
        start: nextOffset,
      })
      abortIfRequested(signal)
      nextOffset = chunk.nextOffset
      lineOffset = chunk.start
      lines = completeLines(chunk.content)
    }
  } finally {
    serializeAddon.dispose()
    terminal.dispose()
  }
}

export function findReplayCheckpoint(index: ReplayIndex, targetTime: number): ReplayCheckpoint {
  const boundedTarget = Math.max(0, Math.min(targetTime, index.duration))
  let selected = index.checkpoints[0]
  for (const checkpoint of index.checkpoints) {
    if (checkpoint.time > boundedTarget) {
      break
    }
    selected = checkpoint
  }
  return selected
}

export async function restoreReplayCursor(
  index: ReplayIndex,
  targetTime: number,
  terminal: ReplayTerminal,
  readChunk: ChunkReader,
  signal: AbortSignal,
): Promise<ReplayCursor> {
  abortIfRequested(signal)
  const checkpoint = findReplayCheckpoint(index, targetTime)
  terminal.reset()
  terminal.resize(checkpoint.cols, checkpoint.rows)
  if (checkpoint.state) {
    await writeAsync(terminal, checkpoint.state)
  }
  const cursor: ReplayCursor = {
    eof: false,
    nextOffset: checkpoint.nextOffset,
    parseTime: checkpoint.time,
    pendingEvents: [],
    recordingId: index.recordingId,
    time: checkpoint.time,
  }
  await advanceReplayCursor(cursor, Math.max(0, Math.min(targetTime, index.duration)), terminal, readChunk, signal)
  return cursor
}

export async function advanceReplayCursor(
  cursor: ReplayCursor,
  targetTime: number,
  terminal: ReplayTerminal,
  readChunk: ChunkReader,
  signal: AbortSignal,
): Promise<void> {
  abortIfRequested(signal)
  while (true) {
    while (cursor.pendingEvents.length > 0) {
      const event = cursor.pendingEvents[0]
      if (event.time > targetTime) {
        return
      }
      cursor.pendingEvents.shift()
      await applyReplayEvent(terminal, event)
      cursor.time = event.time
      abortIfRequested(signal)
    }
    if (cursor.eof) {
      return
    }

    const chunk = await readChunk({
      maxBytes: INDEX_CHUNK_BYTES,
      recordingId: cursor.recordingId,
      start: cursor.nextOffset,
    })
    abortIfRequested(signal)
    if (chunk.nextOffset < cursor.nextOffset || (!chunk.eof && chunk.nextOffset === cursor.nextOffset)) {
      if (chunk.incompleteTail) {
        cursor.eof = true
        return
      }
      throw new Error('The recording reader made no progress.')
    }
    cursor.nextOffset = chunk.nextOffset
    cursor.eof = chunk.eof
    for (const entry of completeLines(chunk.content)) {
      const event = parseEvent(entry.line, cursor.parseTime)
      if (!event) {
        continue
      }
      cursor.parseTime = event.time
      cursor.pendingEvents.push(event)
    }
  }
}
