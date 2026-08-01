export const CONNECTION_SWITCHER_TOUCH_TARGET_PX = 44
export const MAX_SHARED_CONNECTIONS = 100

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const SAFE_ORIGIN = /^https?:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/u
const CONNECTION_STATUSES = new Set(['connected', 'disconnected', 'reconnecting', 'expired', 'revoked'])

function safeText(value, field, maximumLength = 128) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`The connection ${field} must be safe, non-empty text`)
  }
  return value
}

function safeConnection(connection, activeConnectionId) {
  if (!connection || typeof connection !== 'object' || Array.isArray(connection)) {
    throw new TypeError('A connection entry is required')
  }
  if (typeof connection.id !== 'string' || !SAFE_ID.test(connection.id)) throw new TypeError('A safe connection id is required')
  if (typeof connection.origin !== 'string' || !SAFE_ORIGIN.test(connection.origin)) throw new TypeError('A safe connection origin is required')
  if (!CONNECTION_STATUSES.has(connection.status)) throw new TypeError('A supported connection status is required')
  const label = safeText(connection.label, 'label')
  const selected = connection.id === activeConnectionId
  return Object.freeze({
    id: connection.id,
    origin: connection.origin,
    label,
    status: connection.status,
    selected,
    role: 'option',
    ariaSelected: selected,
    activateAction: Object.freeze({
      id: 'activate-connection',
      connectionId: connection.id,
      label: `Open ${label}`,
      minTouchTargetPx: CONNECTION_SWITCHER_TOUCH_TARGET_PX,
    }),
    forgetAction: Object.freeze({
      id: 'forget-connection',
      connectionId: connection.id,
      label: `Remove ${label}`,
      minTouchTargetPx: CONNECTION_SWITCHER_TOUCH_TARGET_PX,
    }),
  })
}

/**
 * Shared renderer-neutral connection selector for Desktop and web. It accepts
 * sanitized profile metadata only; credentials, pairing URLs, browser storage,
 * Electron and concrete transports remain outside this UI contract.
 */
export function createConnectionSwitcherPanel({ connections, activeConnectionId, layout, status = 'ready' }) {
  if (layout !== 'wide' && layout !== 'narrow') throw new TypeError('The connection switcher layout must be wide or narrow')
  if (!['ready', 'empty', 'unavailable', 'failed'].includes(status)) throw new TypeError('A supported connection switcher status is required')
  if (!Array.isArray(connections) || connections.length > MAX_SHARED_CONNECTIONS) throw new TypeError(`Connections must contain at most ${MAX_SHARED_CONNECTIONS} entries`)
  if (activeConnectionId !== undefined && (typeof activeConnectionId !== 'string' || !SAFE_ID.test(activeConnectionId))) throw new TypeError('A safe active connection id is required')
  if (status === 'ready' && connections.length === 0) throw new TypeError('Ready connection switcher must include at least one connection')
  if (status !== 'ready' && connections.length !== 0) throw new TypeError('Non-ready connection switcher cannot include connections')

  const ids = new Set()
  const entries = connections.map(connection => {
    const entry = safeConnection(connection, activeConnectionId)
    if (ids.has(entry.id)) throw new TypeError('Connection ids must be unique')
    ids.add(entry.id)
    return entry
  })
  if (activeConnectionId !== undefined && !ids.has(activeConnectionId)) throw new TypeError('The active connection must be present')

  return Object.freeze({
    role: 'region',
    ariaLabel: 'Connections',
    layout,
    status,
    list: Object.freeze({
      role: 'listbox',
      ariaLabel: 'Saved Terminay servers',
      ariaOrientation: layout === 'narrow' ? 'horizontal' : 'vertical',
      overflowX: layout === 'narrow' ? 'auto' : 'visible',
    }),
    connections: Object.freeze(entries),
    addAction: Object.freeze({ id: 'add-connection', label: 'Connect to server', minTouchTargetPx: CONNECTION_SWITCHER_TOUCH_TARGET_PX }),
    retryAction: status === 'failed'
      ? Object.freeze({ id: 'retry-connections', label: 'Retry connections', minTouchTargetPx: CONNECTION_SWITCHER_TOUCH_TARGET_PX })
      : undefined,
  })
}
