export const MCP_SERVER_CONTROL_TOUCH_TARGET_PX = 44
export const MAX_MCP_SERVERS = 100

const PANEL_COPY = Object.freeze({
  loading: Object.freeze({ label: 'Loading MCP servers', description: 'Loading MCP server status…', busy: true, retryable: false }),
  ready: Object.freeze({ label: 'MCP servers ready', description: 'Manage the available MCP servers.', busy: false, retryable: false }),
  empty: Object.freeze({ label: 'No MCP servers', description: 'This workspace has no configured MCP servers.', busy: false, retryable: false }),
  unavailable: Object.freeze({ label: 'MCP unavailable', description: 'MCP server controls are not available for this workspace.', busy: false, retryable: false }),
  failed: Object.freeze({ label: 'MCP status failed', description: 'Terminay could not load MCP server status. Try again.', busy: false, retryable: true }),
})

const SERVER_COPY = Object.freeze({
  running: Object.freeze({ label: 'Running', action: 'stop-mcp-server', actionLabel: 'Stop' }),
  stopped: Object.freeze({ label: 'Stopped', action: 'start-mcp-server', actionLabel: 'Start' }),
  failed: Object.freeze({ label: 'Failed', action: 'retry-mcp-server', actionLabel: 'Retry' }),
  installing: Object.freeze({ label: 'Installing', action: undefined, actionLabel: undefined }),
})

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

function safeId(value, field) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new TypeError(`A safe MCP server ${field} is required`)
  return value
}

function safeText(value, field, maximumLength) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`A safe MCP server ${field} is required`)
  }
  return value
}

function normalizeServer(server) {
  if (!server || typeof server !== 'object' || Array.isArray(server)) throw new TypeError('Each MCP server must be an object')
  if (!Object.hasOwn(SERVER_COPY, server.state)) throw new TypeError('Each MCP server requires a supported state')
  const id = safeId(server.id, 'id')
  const label = safeText(server.label, 'label', 160)
  const detail = server.detail === undefined ? undefined : safeText(server.detail, 'detail', 240)
  const copy = SERVER_COPY[server.state]
  const controlAction = copy.action === undefined ? undefined : Object.freeze({
    id: copy.action,
    serverId: id,
    label: `${copy.actionLabel} ${label}`,
    minTouchTargetPx: MCP_SERVER_CONTROL_TOUCH_TARGET_PX,
  })
  return Object.freeze({
    id,
    label,
    detail,
    state: server.state,
    stateLabel: copy.label,
    role: 'listitem',
    controlAction,
  })
}

/**
 * Shared, host- and transport-neutral MCP server control contract. The host
 * supplies the canonical server projection and executes the exact action
 * intent; this model never discovers, installs, or starts a process itself.
 */
export function createMcpServerControlPanel({ status, servers = [], layout }) {
  if (!Object.hasOwn(PANEL_COPY, status)) throw new TypeError('A supported MCP server panel status is required')
  if (layout !== 'wide' && layout !== 'narrow') throw new TypeError('The MCP server control layout must be wide or narrow')
  if (!Array.isArray(servers) || servers.length > MAX_MCP_SERVERS) throw new TypeError(`MCP servers must contain at most ${MAX_MCP_SERVERS} entries`)
  if ((status === 'loading' || status === 'empty' || status === 'unavailable' || status === 'failed') && servers.length !== 0) {
    throw new TypeError('Only a ready MCP server panel may include servers')
  }
  if (status === 'ready' && servers.length === 0) throw new TypeError('A ready MCP server panel must include at least one server')

  const items = servers.map(normalizeServer)
  if (new Set(items.map(item => item.id)).size !== items.length) throw new TypeError('MCP server ids must be unique')
  const copy = PANEL_COPY[status]
  const retryAction = copy.retryable
    ? Object.freeze({ id: 'retry-mcp-servers', label: 'Retry MCP servers', minTouchTargetPx: MCP_SERVER_CONTROL_TOUCH_TARGET_PX })
    : undefined

  return Object.freeze({
    role: 'region',
    ariaLabel: 'MCP servers',
    layout,
    status,
    statusLabel: copy.label,
    statusDescription: copy.description,
    statusRegion: Object.freeze({ role: 'status', ariaLive: 'polite', ariaAtomic: true, ariaBusy: copy.busy }),
    servers: Object.freeze({ role: 'list', ariaLabel: 'MCP servers', items: Object.freeze(items) }),
    retryAction,
  })
}
