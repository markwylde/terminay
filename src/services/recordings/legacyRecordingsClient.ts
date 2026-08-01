import {
  RecordingsClient,
  TerminayClientFacade,
  type RecordingListItem,
} from '@terminay/client-core'
import type { CommandResultEnvelope, JsonValue, QueryResultEnvelope } from '@terminay/protocol'
import type {
  TerminalRecordingListItem,
  TerminalRecordingStartMetadata,
  TerminalRecordingState,
} from '../../types/terminay'

/**
 * Compatibility-only surface for the legacy Electron preload. The timeline
 * itself depends on RecordingsClient and canonical recordings.* operations;
 * this adapter is the only place that knows the old method names while the
 * server protocol migration is in progress.
 */
export type LegacyRecordingsApi = Readonly<{
  deleteTerminalRecordingById(recordingId: string): Promise<void>
  getTerminalRecordingState(sessionId: string): Promise<TerminalRecordingState>
  listTerminalRecordings(): Promise<TerminalRecordingListItem[]>
  onTerminalRecordingChanged(listener: (message: import('../../types/terminay').TerminalRecordingChangeMessage) => void): () => void
  readTerminalRecordingChunk(request: import('../../types/terminay').TerminalRecordingChunkRequest): Promise<import('../../types/terminay').TerminalRecordingChunk>
  revealTerminalRecordingById(recordingId: string): Promise<void>
  startTerminalRecording(sessionId: string, metadata?: TerminalRecordingStartMetadata): Promise<TerminalRecordingState>
  stopTerminalRecording(sessionId: string): Promise<TerminalRecordingState>
}>

export type LegacyRecordingsClient = RecordingsClient & {
  /** Compatibility-only state hydration while the server query is adopted. */
  getState: (sessionId: string) => Promise<TerminalRecordingState>
  /** Compatibility-only lifecycle stream while the shared event is adopted. */
  onStateChanged: (listener: (state: TerminalRecordingState) => void) => () => void
}

/**
 * Capture only the named legacy recordings operations. Composition callers
 * pass the exact preload capability directly, and this snapshot
 * ensures the adapter never keeps broad host authority or observes later
 * method replacement.
 */
export function captureLegacyRecordingsCapability(api: LegacyRecordingsApi): LegacyRecordingsApi {
  const {
    deleteTerminalRecordingById,
    getTerminalRecordingState,
    listTerminalRecordings,
    onTerminalRecordingChanged,
    readTerminalRecordingChunk,
    revealTerminalRecordingById,
    startTerminalRecording,
    stopTerminalRecording,
  } = api
  for (const [name, value] of Object.entries({
    deleteTerminalRecordingById,
    getTerminalRecordingState,
    listTerminalRecordings,
    onTerminalRecordingChanged,
    readTerminalRecordingChunk,
    revealTerminalRecordingById,
    startTerminalRecording,
    stopTerminalRecording,
  })) {
    if (typeof value !== 'function') throw new TypeError(`legacy recordings capability ${name} is unavailable`)
  }
  return Object.freeze({
    deleteTerminalRecordingById: (recordingId) => deleteTerminalRecordingById(recordingId),
    getTerminalRecordingState: (sessionId) => getTerminalRecordingState(sessionId),
    listTerminalRecordings: () => listTerminalRecordings(),
    onTerminalRecordingChanged: (listener) => onTerminalRecordingChanged(listener),
    readTerminalRecordingChunk: (request) => readTerminalRecordingChunk(request),
    revealTerminalRecordingById: (recordingId) => revealTerminalRecordingById(recordingId),
    startTerminalRecording: (sessionId, metadata) => startTerminalRecording(sessionId, metadata),
    stopTerminalRecording: (sessionId) => stopTerminalRecording(sessionId),
  })
}

/**
 * Compatibility callers must name the host capability they are adapting.
 * Keeping this explicit prevents an incidental renderer import from silently
 * reacquiring the broad preload object as a second authority.
 */
export function createLegacyRecordingsClient(api: LegacyRecordingsApi): LegacyRecordingsClient {
  const capability = captureLegacyRecordingsCapability(api)
  const transport = createLegacyRecordingsEnvelopeTransport(capability)
  const client = new RecordingsClient(new TerminayClientFacade(transport))
  return Object.assign(client, {
    getState: (sessionId: string) => capability.getTerminalRecordingState(sessionId),
    onStateChanged: (listener: (state: TerminalRecordingState) => void) =>
      capability.onTerminalRecordingChanged(({ state }) => listener(state)),
  })
}

/** Convert the validated shared DTO to the legacy timeline view model while
 * the existing native window is being migrated. No path fields are restored. */
export function toLegacyRecordingMetadata(item: RecordingListItem): TerminalRecordingListItem {
  return {
    version: 2,
    bytesWritten: item.bytesWritten,
    castAvailable: item.castAvailable,
    capturedInput: item.capturedInput,
    color: item.color,
		// The canonical recording DTO deliberately carries no host presentation
		// metadata. The legacy timeline retains its historical shape with safe
		// defaults while it is migrated off this adapter.
    cols: 80,
    cwdLabel: item.cwdLabel,
    durationMs: item.durationMs,
    endedAt: item.endedAt,
    errorMessage: item.errorMessage,
    eventCount: item.eventCount,
    exitCode: item.exitCode,
    inputPolicy: item.inputPolicy,
    projectColor: null,
    projectEmoji: item.emoji,
    projectId: item.projectId,
    projectTitle: item.projectName,
    recordingId: item.recordingId,
    recordingState: item.recordingState,
    rows: 24,
    sensitiveInputPolicy: item.sensitiveInputPolicy,
    sessionId: item.sessionId,
    shellName: item.shellName,
    signal: item.signal,
    startedAt: item.startedAt,
    theme: null,
    title: item.title,
  }
}

/** Exposed for adapter tests; shared UI should use createLegacyRecordingsClient. */
export function createLegacyRecordingsEnvelopeTransport(api: LegacyRecordingsApi): LegacyEnvelopeClient {
  return {
    async query<T extends JsonValue = JsonValue>(operation: string, payload: JsonValue = {}): Promise<QueryResultEnvelope & { result?: T }> {
      const result = await queryLegacy(api, operation, payload)
      return { type: 'query_result', queryId: `legacy-${operation}`, ok: true, result: result as T }
    },
    async command<T extends JsonValue = JsonValue>(operation: string, payload: JsonValue = {}): Promise<CommandResultEnvelope & { result?: T }> {
      const result = await commandLegacy(api, operation, payload)
      return { type: 'command_result', commandId: `legacy-${operation}`, correlationId: `legacy-${operation}`, ok: true, result: result as T }
    },
  }
}

type LegacyEnvelopeClient = {
  query<T extends JsonValue = JsonValue>(operation: string, payload?: JsonValue): Promise<QueryResultEnvelope & { result?: T }>
  command<T extends JsonValue = JsonValue>(operation: string, payload?: JsonValue): Promise<CommandResultEnvelope & { result?: T }>
}

async function queryLegacy(api: LegacyRecordingsApi, operation: string, payload: JsonValue): Promise<JsonValue> {
  switch (operation) {
    case 'recordings.list': {
      const recordings = await api.listTerminalRecordings()
      const items = recordings.map(toCanonicalItem)
      return { items, total: items.length, offset: 0, limit: Math.max(1, Math.min(200, items.length || 1)) } as unknown as JsonValue
    }
    case 'recordings.replay':
      return (await api.readTerminalRecordingChunk(readChunkRequest(payload))) as unknown as JsonValue
    default:
      throw new Error(`legacy recording query is unsupported: ${operation}`)
  }
}

async function commandLegacy(api: LegacyRecordingsApi, operation: string, payload: JsonValue): Promise<JsonValue> {
  const record = readRecord(payload)
  switch (operation) {
    case 'recordings.start': {
      const sessionId = readString(record.sessionId, 'sessionId')
      const metadata = readOptionalStartMetadata(
        record.metadata === undefined ? record : readRecord(record.metadata),
      )
      return (await api.startTerminalRecording(sessionId, metadata)) as unknown as JsonValue
    }
    case 'recordings.stop':
      return (await api.stopTerminalRecording(readString(record.sessionId, 'sessionId'))) as unknown as JsonValue
    case 'recordings.delete':
      if (record.stopFirst === true) throw new Error('legacy recording delete cannot stop an active session')
      await api.deleteTerminalRecordingById(readString(record.recordingId, 'recordingId'))
      return null
    case 'recordings.reveal': {
      const recordingId = readString(record.recordingId, 'recordingId')
      await api.revealTerminalRecordingById(recordingId)
      return { recordingId, available: true, guidance: 'The recording was revealed by the host.' }
    }
    default:
      throw new Error(`legacy recording command is unsupported: ${operation}`)
  }
}

function toCanonicalItem(recording: TerminalRecordingListItem): RecordingListItem {
  return {
    recordingId: recording.recordingId,
    sessionId: recording.sessionId,
    serverId: null,
    projectId: recording.projectId,
    projectName: recording.projectTitle,
    title: recording.title,
    note: null,
    color: recording.color,
    emoji: recording.projectEmoji,
    startedAt: recording.startedAt,
    endedAt: recording.endedAt,
    durationMs: recording.durationMs,
    exitCode: recording.exitCode,
    signal: recording.signal,
    recordingState: recording.recordingState,
    capturedInput: recording.capturedInput,
    inputPolicy: recording.inputPolicy,
    sensitiveInputPolicy: recording.sensitiveInputPolicy,
    eventCount: recording.eventCount,
    bytesWritten: recording.bytesWritten,
    castSize: recording.bytesWritten,
    castAvailable: recording.castAvailable,
    cwdLabel: recording.cwdLabel,
    shellName: recording.shellName,
    format: 'asciicast',
    formatVersion: 3,
    errorMessage: recording.errorMessage ?? null,
  }
}

function readChunkRequest(payload: JsonValue): { recordingId: string; start?: number; maxBytes?: number } {
  const record = readRecord(payload)
  const request: { recordingId: string; start?: number; maxBytes?: number } = { recordingId: readString(record.recordingId, 'recordingId') }
  if (record.start !== undefined) request.start = readUInt(record.start, 'start')
  if (record.maxBytes !== undefined) request.maxBytes = readUInt(record.maxBytes, 'maxBytes')
  return request
}

function readOptionalStartMetadata(record: Record<string, JsonValue>): TerminalRecordingStartMetadata | undefined {
  const metadata: TerminalRecordingStartMetadata = {}
  for (const key of ['color', 'emoji', 'inheritsProjectColor', 'projectColor', 'projectEmoji', 'projectId', 'projectTitle', 'title'] as const) {
    const value = record[key]
    if (value === undefined) continue
    if (key === 'inheritsProjectColor') {
      if (typeof value !== 'boolean') throw new TypeError(`${key} is invalid`)
      metadata[key] = value
    } else {
      if (typeof value !== 'string' || value.length > 512 || value.includes('\0')) throw new TypeError(`${key} is invalid`)
      metadata[key] = value
    }
  }
  if (typeof record.projectName === 'string') metadata.projectTitle = record.projectName
  return Object.keys(metadata).length === 0 ? undefined : metadata
}

function readRecord(payload: JsonValue): Record<string, JsonValue> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new TypeError('recording payload is invalid')
  return payload
}

function readString(value: JsonValue | undefined, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || value.includes('\0')) throw new TypeError(`${name} is invalid`)
  return value
}

function readUInt(value: JsonValue, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} is invalid`)
  return value
}
