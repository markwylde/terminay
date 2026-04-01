export type RemoteSessionSummary = {
  color: string
  cols: number
  emoji: string
  exitCode: number | null
  id: string
  rows: number
  title: string
  viewportHeight?: number
  viewportWidth?: number
  projectId?: string
  projectTitle?: string
  projectEmoji?: string
  projectColor?: string
}

export type RemoteSessionSnapshot = RemoteSessionSummary & {
  buffer: string
}

export type RemoteClientMessage =
  | { connectionId: string; seq: number; type: 'list-sessions' }
  | { connectionId: string; seq: number; sessionId: string; type: 'attach-session' }
  | { connectionId: string; seq: number; sessionId: string; type: 'detach-session' }
  | { connectionId: string; payload: string; seq: number; sessionId: string; type: 'write' }
  | { cols: number; connectionId: string; rows: number; seq: number; sessionId: string; type: 'resize' }
  | { connectionId: string; seq: number; type: 'ping' }

export type RemoteServerMessage =
  | {
      connectionCount: number
      connectionId: string
      sessions: RemoteSessionSummary[]
      type: 'session-list'
    }
  | { session: RemoteSessionSnapshot; type: 'session-opened' }
  | { id: string; type: 'session-closed' }
  | { session: RemoteSessionSummary; type: 'session-updated' }
  | { payload: string; sessionId: string; type: 'output' }
  | { exitCode: number; sessionId: string; type: 'exit' }
  | { message: string; type: 'error' }
  | { seq: number; type: 'pong' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getCommonFields(value: Record<string, unknown>): {
  connectionId: string
  seq: number
} | null {
  if (typeof value.connectionId !== 'string' || typeof value.seq !== 'number' || !Number.isFinite(value.seq)) {
    return null
  }

  return {
    connectionId: value.connectionId,
    seq: value.seq,
  }
}

export function parseRemoteClientMessage(raw: string): RemoteClientMessage | null {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isRecord(parsed) || typeof parsed.type !== 'string') {
    return null
  }

  const common = getCommonFields(parsed)
  if (!common) {
    return null
  }

  switch (parsed.type) {
    case 'list-sessions':
    case 'ping':
      return { ...common, type: parsed.type }
    case 'attach-session':
    case 'detach-session':
      if (typeof parsed.sessionId !== 'string') {
        return null
      }
      return { ...common, sessionId: parsed.sessionId, type: parsed.type }
    case 'write':
      if (typeof parsed.sessionId !== 'string' || typeof parsed.payload !== 'string') {
        return null
      }
      return {
        ...common,
        payload: parsed.payload,
        sessionId: parsed.sessionId,
        type: 'write',
      }
    case 'resize':
      if (
        typeof parsed.sessionId !== 'string' ||
        typeof parsed.cols !== 'number' ||
        typeof parsed.rows !== 'number' ||
        !Number.isFinite(parsed.cols) ||
        !Number.isFinite(parsed.rows)
      ) {
        return null
      }

      return {
        ...common,
        cols: parsed.cols,
        rows: parsed.rows,
        sessionId: parsed.sessionId,
        type: 'resize',
      }
    default:
      return null
  }
}
