import { useEffect, useState } from 'react'
import type { AgentClientEntry, AgentClientSnapshot, AgentStatusClient } from '@terminay/client-core'

export interface SharedAgentRouteBodyProps {
  readonly client?: AgentStatusClient
  readonly loading?: boolean
}

const PROVIDER_LABELS: Record<AgentClientEntry['provider'], string> = {
  codex: 'Codex',
  'claude-code': 'Claude Code',
  omp: 'omp',
}

/** Live, server-owned agent projection shared by Desktop and browser hosts. */
export function SharedAgentRouteBody({ client, loading = false }: SharedAgentRouteBodyProps) {
  const [snapshot, setSnapshot] = useState<AgentClientSnapshot | null>(() => client?.snapshot ?? null)
  const [failed, setFailed] = useState<string>()

  useEffect(() => {
    if (client === undefined) {
      setSnapshot(null)
      return
    }
    let active = true
    setSnapshot(client.snapshot)
    const unsubscribe = client.onChange((next) => {
      if (active) {
        setFailed(undefined)
        setSnapshot(next)
      }
    })
    void client.refresh().catch((cause) => {
      if (active) setFailed(cause instanceof Error ? cause.message : 'Terminay could not load agent status.')
    })
    return () => { active = false; unsubscribe() }
  }, [client])

  const agents = snapshot === null ? [] : Object.values(snapshot.entries)
  return (
    <div className="shared-production-route" data-shared-route-body="agents">
      <header><h1>Agents</h1><p>Live agent activity from the selected Terminay server.</p></header>
      {client === undefined && loading && <p role="status" aria-busy="true">Loading agents…</p>}
      {client === undefined && !loading && <p role="status">Agent status is unavailable for this connection.</p>}
      {client !== undefined && snapshot === null && <p role="status" aria-busy="true">Loading agents…</p>}
      {failed === undefined ? null : <p role="alert">{failed}</p>}
      {client !== undefined && failed === undefined && snapshot !== null && agents.length === 0 && <p role="status">No agents are active.</p>}
      {failed === undefined && agents.length > 0 && (
        <ul aria-label="Agent activity">
          {agents.map((agent) => (
            <li key={agent.entryId} className="shared-production-route__card">
              <strong>{PROVIDER_LABELS[agent.provider]} {agent.kind === 'subagent' ? 'subagent' : 'agent'}</strong>
              <span>{agentStateLabel(agent.state)}</span>
              {agent.unread && <span>Unread activity</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function agentStateLabel(state: 'working' | 'waiting' | 'blocked' | 'done' | 'idle'): string {
  if (state === 'blocked') return 'Needs input'
  if (state === 'done') return 'Completed'
  return state[0]?.toUpperCase() + state.slice(1)
}
