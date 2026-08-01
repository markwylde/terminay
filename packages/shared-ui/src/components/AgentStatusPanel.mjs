export const AGENT_STATUS_TOUCH_TARGET_PX = 44

const STATUS_COPY = Object.freeze({
  working: Object.freeze({ label: 'Working', announcement: 'is working' }),
  waiting: Object.freeze({ label: 'Waiting', announcement: 'is waiting' }),
  'needs-input': Object.freeze({ label: 'Needs input', announcement: 'needs input' }),
  completed: Object.freeze({ label: 'Completed', announcement: 'completed work' }),
  failed: Object.freeze({ label: 'Failed', announcement: 'failed' }),
  idle: Object.freeze({ label: 'Idle', announcement: 'is idle' }),
})

const MAX_AGENTS = 100
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

function requireSafeText(value, field, maximumLength) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`Each agent requires a safe ${field}`)
  }
  return value
}

function normalizeAgent(agent) {
  if (!agent || typeof agent !== 'object' || Array.isArray(agent)) {
    throw new TypeError('Each agent must be an object')
  }
  if (typeof agent.id !== 'string' || !SAFE_ID.test(agent.id)) {
    throw new TypeError('Each agent requires a safe id')
  }
  if (!Object.hasOwn(STATUS_COPY, agent.status)) {
    throw new TypeError('Each agent requires a supported status')
  }

  const label = requireSafeText(agent.label, 'label', 128)
  const detail = agent.detail === undefined
    ? undefined
    : requireSafeText(agent.detail, 'detail', 240)
  return Object.freeze({
    id: agent.id,
    label,
    detail,
    status: agent.status,
  })
}

/**
 * Produces a renderer-neutral agent activity panel for shared browser and
 * desktop workspace hosts. This deliberately contains no client, transport,
 * browser, or Electron concern: the host supplies its authoritative activity
 * snapshot and invokes the `select-agent` intent if its surrounding route can
 * display agent details.
 */
export function createAgentStatusPanel({ agents, layout, selectedAgentId = null }) {
  if (!Array.isArray(agents) || agents.length > MAX_AGENTS) {
    throw new TypeError(`Agent status panels require at most ${MAX_AGENTS} agents`)
  }
  if (layout !== 'wide' && layout !== 'narrow') {
    throw new TypeError('The agent status layout must be wide or narrow')
  }
  if (selectedAgentId !== null && (typeof selectedAgentId !== 'string' || !SAFE_ID.test(selectedAgentId))) {
    throw new TypeError('The selected agent id must be null or a safe agent id')
  }

  const normalized = agents.map(normalizeAgent)
  if (new Set(normalized.map(agent => agent.id)).size !== normalized.length) {
    throw new TypeError('Agent status panel ids must be unique')
  }
  if (selectedAgentId !== null && !normalized.some(agent => agent.id === selectedAgentId)) {
    throw new TypeError('The selected agent id must identify an agent in the panel')
  }

  const counts = Object.fromEntries(Object.keys(STATUS_COPY).map(status => [status, 0]))
  const items = Object.freeze(normalized.map(agent => {
    const copy = STATUS_COPY[agent.status]
    counts[agent.status] += 1
    return Object.freeze({
      ...agent,
      role: 'listitem',
      ariaCurrent: agent.id === selectedAgentId ? 'true' : undefined,
      ariaLabel: `${agent.label} ${copy.announcement}`,
      statusLabel: copy.label,
      selectAction: Object.freeze({
        id: 'select-agent',
        agentId: agent.id,
        label: `Show ${agent.label}`,
        minTouchTargetPx: AGENT_STATUS_TOUCH_TARGET_PX,
      }),
    })
  }))

  return Object.freeze({
    role: 'region',
    ariaLabel: 'Agents',
    layout,
    empty: items.length === 0,
    emptyMessage: items.length === 0 ? 'No agents are active.' : undefined,
    summary: Object.freeze(counts),
    list: Object.freeze({
      role: 'list',
      ariaLabel: 'Agent activity',
      items,
    }),
  })
}
