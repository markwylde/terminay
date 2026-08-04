export const CONNECTION_ERROR_TOUCH_TARGET_PX = 44

const STATUS_COPY = Object.freeze({
  offline: Object.freeze({
    title: 'Server is offline',
    description: 'Terminay could not reach this server. Check that it is running, then try again.',
    primaryAction: 'retry',
  }),
  'relay-unavailable': Object.freeze({
    title: 'Relay is unavailable',
    description: 'The secure relay is not available. Check the server connection and try again.',
    primaryAction: 'retry',
  }),
  'webrtc-failed': Object.freeze({
    title: 'Secure connection failed',
    description: 'Terminay could not establish a secure connection to this server. Try again or use another connection path.',
    primaryAction: 'retry',
  }),
  expired: Object.freeze({
    title: 'Connection expired',
    description: 'This server connection is no longer valid. Reconnect to continue.',
    primaryAction: 'reconnect',
  }),
  revoked: Object.freeze({
    title: 'Access was revoked',
    description: 'This device is no longer authorized for this server. Remove it and use a new server URL to reconnect.',
    primaryAction: 'forget',
  }),
  'identity-mismatch': Object.freeze({
    title: 'Server identity changed',
    description: 'The saved server identity does not match the server at this URL. Remove this saved connection before pairing again.',
    primaryAction: 'forget',
  }),
  incompatible: Object.freeze({
    title: 'Server is incompatible',
    description: 'This server does not support the required Terminay protocol version.',
    primaryAction: 'forget',
  }),
  unreachable: Object.freeze({
    title: 'Server is unreachable',
    description: 'Terminay could not reach this server. Check its URL and network connection, then try again.',
    primaryAction: 'retry',
  }),
})

/**
 * Produces the complete renderer-neutral contract for a saved-server failure.
 * Both hosts can render the same status copy, actions, touch targets and ARIA
 * semantics without importing a transport, browser API or Electron primitive.
 */
export function createConnectionErrorPanel({ status, serverLabel, layout }) {
  if (!Object.hasOwn(STATUS_COPY, status)) {
    throw new TypeError('A supported connection error status is required')
  }
  if (typeof serverLabel !== 'string' || serverLabel.trim().length === 0 || serverLabel.length > 128 || /[\u0000-\u001f\u007f]/u.test(serverLabel)) {
    throw new TypeError('The server label must be a safe, non-empty label')
  }
  if (layout !== 'wide' && layout !== 'narrow') {
    throw new TypeError('The connection error layout must be wide or narrow')
  }

  const copy = STATUS_COPY[status]
  const primary = action(copy.primaryAction)
  const secondary = action('forget')
  return Object.freeze({
    role: 'alert',
    ariaLive: 'assertive',
    ariaAtomic: true,
    ariaLabel: `Connection problem for ${serverLabel}`,
    status,
    serverLabel,
    layout,
    title: copy.title,
    description: copy.description,
    actions: Object.freeze(primary.id === secondary.id ? [primary] : [primary, secondary]),
  })
}

function action(id) {
  const labels = {
    retry: 'Try again',
    reconnect: 'Reconnect',
    forget: 'Remove server',
  }
  return Object.freeze({
    id,
    label: labels[id],
    minTouchTargetPx: CONNECTION_ERROR_TOUCH_TARGET_PX,
  })
}
