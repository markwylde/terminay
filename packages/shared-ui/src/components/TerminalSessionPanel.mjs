export const TERMINAL_SESSION_TOUCH_TARGET_PX = 44

const STATUS_COPY = Object.freeze({
  connecting: Object.freeze({ label: 'Connecting', description: 'Connecting terminal session…', busy: true, retryable: false }),
  attached: Object.freeze({ label: 'Connected', description: 'Terminal session is connected.', busy: false, retryable: false }),
  reconnecting: Object.freeze({ label: 'Reconnecting', description: 'Restoring the terminal session…', busy: true, retryable: false }),
  disconnected: Object.freeze({ label: 'Disconnected', description: 'Terminal session was disconnected.', busy: false, retryable: true }),
  failed: Object.freeze({ label: 'Connection failed', description: 'Terminal session could not be connected.', busy: false, retryable: true }),
  closed: Object.freeze({ label: 'Terminal closed', description: 'Terminal session has ended.', busy: false, retryable: false }),
})

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

function requireSafeText(value, field, maximumLength) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`The terminal ${field} must be safe, non-empty text`)
  }
  return value
}

/**
 * Creates the renderer-neutral state contract for one terminal attachment.
 * Hosts render this exact model in a desktop panel or a narrow browser surface;
 * terminal byte streams, client calls, and host APIs deliberately stay outside.
 */
export function createTerminalSessionPanel({ terminalId, label, status, layout, detail }) {
  if (typeof terminalId !== 'string' || !SAFE_ID.test(terminalId)) {
    throw new TypeError('A safe terminal id is required')
  }
  if (!Object.hasOwn(STATUS_COPY, status)) {
    throw new TypeError('A supported terminal status is required')
  }
  if (layout !== 'wide' && layout !== 'narrow') {
    throw new TypeError('The terminal session layout must be wide or narrow')
  }

  const safeLabel = requireSafeText(label, 'label', 128)
  const safeDetail = detail === undefined ? undefined : requireSafeText(detail, 'detail', 240)
  const copy = STATUS_COPY[status]
  const retryAction = copy.retryable
    ? Object.freeze({ id: 'retry-terminal', terminalId, label: 'Retry terminal', minTouchTargetPx: TERMINAL_SESSION_TOUCH_TARGET_PX })
    : undefined

  return Object.freeze({
    role: 'region',
    ariaLabel: `Terminal ${safeLabel}`,
    layout,
    terminalId,
    label: safeLabel,
    status,
    statusLabel: copy.label,
    statusDescription: copy.description,
    statusRegion: Object.freeze({
      role: 'status',
      ariaLive: 'polite',
      ariaAtomic: true,
      ariaBusy: copy.busy,
    }),
    outputRegion: Object.freeze({ role: 'log', ariaLive: 'off', ariaLabel: `Terminal output for ${safeLabel}` }),
    detail: safeDetail,
    retryAction,
  })
}
