import type { AgentStatusService } from '../../packages/server-core/src/activity/agentService'
import type { ActivitySessionIdentity } from '../../packages/server-core/src/activity/service'
import type { AgentStatusSnapshot } from '../../src/types/agentStatus'

/** Server-owned compatibility projection. This is deliberately Electron-free:
 * application renderers consume it through the authenticated server protocol,
 * never through an Electron IPC handler. */
export interface AgentStatusIpcAuthority {
  getSnapshot: () => AgentStatusSnapshot
  subscribe: (listener: (snapshot: AgentStatusSnapshot) => void) => () => void
  markAcknowledged: (entryId: string) => boolean
  markTerminalAcknowledged: (terminalSessionId: string) => number
}

export interface ServerAgentStatusIpcAdapterOptions {
  readonly agents: AgentStatusService
  /** Resolves the immutable server/project/session scope retained by the host. */
  readonly agentIdentity: (terminalSessionId: string) => ActivitySessionIdentity | undefined
}

/**
 * Electron-free compatibility adapter for the server-owned agent authority.
 * It deliberately owns no snapshot state: every read and acknowledgement is
 * scoped through the composed AgentStatusService.
 */
export function createServerAgentStatusIpcAdapter({
  agents,
  agentIdentity,
}: ServerAgentStatusIpcAdapterOptions): AgentStatusIpcAuthority {
  const scopedSnapshot = (snapshot: AgentStatusSnapshot): AgentStatusSnapshot => {
    const entries = Object.fromEntries(Object.entries(snapshot.entries).filter(([, entry]) => {
      const identity = agentIdentity(entry.activationTerminalSessionId)
      return identity !== undefined && agents.isSessionActive(identity)
    }))
    return Object.keys(entries).length === Object.keys(snapshot.entries).length
      ? snapshot
      : Object.freeze({ ...snapshot, entries: Object.freeze(entries) })
  }

  return {
    // The server store deliberately retains historical rows for its own
    // project-scoped protocol. Legacy preload IPC has no project claim, so
    // expose only entries that still resolve to the exact live authority
    // identity. This prevents stale/recycled ids from disclosing a prior
    // project's row through the compatibility path.
    getSnapshot: () => scopedSnapshot(agents.getSnapshot()),
    subscribe: (listener) => agents.subscribe((snapshot) => listener(scopedSnapshot(snapshot))),
    markAcknowledged: (entryId) => {
      const entry = agents.getSnapshot().entries[entryId]
      const identity = entry === undefined ? undefined : agentIdentity(entry.activationTerminalSessionId)
      if (identity === undefined) return false
      try {
        return agents.acknowledge(identity, entryId)
      } catch {
        return false
      }
    },
    markTerminalAcknowledged: (terminalSessionId) => {
      const identity = agentIdentity(terminalSessionId)
      if (identity === undefined) return 0
      const unread = Object.values(agents.getSnapshot().entries)
        .filter((entry) => entry.activationTerminalSessionId === terminalSessionId && entry.unread).length
      try {
        agents.acknowledge(identity)
      } catch {
        return 0
      }
      return unread
    },
  }
}
