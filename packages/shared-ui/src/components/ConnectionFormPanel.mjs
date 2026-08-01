export const CONNECTION_FORM_TOUCH_TARGET_PX = 44
export const MAX_SERVER_URL_LENGTH = 2048

const STATUS_COPY = Object.freeze({
  idle: Object.freeze({ label: 'Connect to a server', description: 'Enter a Terminay server URL to connect.', busy: false, alert: false }),
  connecting: Object.freeze({ label: 'Connecting to server', description: 'Connecting securely to the Terminay server…', busy: true, alert: false }),
  failed: Object.freeze({ label: 'Could not connect', description: 'The Terminay server could not be reached. Check the URL and try again.', busy: false, alert: true }),
})

function safeServerUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SERVER_URL_LENGTH || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError('The server URL must be safe, non-empty text')
  }

  let url
  try {
    url = new URL(value)
  } catch {
    throw new TypeError('The server URL must be an absolute HTTP or HTTPS URL')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new TypeError('The server URL must be a canonical HTTP or HTTPS origin')
  }
  return url.origin
}

/**
 * Shared, renderer-neutral connection form contract. It represents exactly one
 * server URL: pairing and credential exchange remain an authenticated client
 * concern, never form state or host-local presentation state.
 */
export function createConnectionFormPanel({ serverUrl, status, layout }) {
  if (!Object.hasOwn(STATUS_COPY, status)) throw new TypeError('A supported connection form status is required')
  if (layout !== 'wide' && layout !== 'narrow') throw new TypeError('The connection form layout must be wide or narrow')

  const canonicalServerUrl = safeServerUrl(serverUrl)
  const copy = STATUS_COPY[status]
  const connecting = status === 'connecting'

  return Object.freeze({
    role: 'region',
    ariaLabel: 'Connect to a Terminay server',
    layout,
    status,
    statusRegion: Object.freeze({
      role: copy.alert ? 'alert' : 'status',
      ariaLive: copy.alert ? 'assertive' : 'polite',
      ariaAtomic: true,
      ariaBusy: copy.busy,
      label: copy.label,
      description: copy.description,
    }),
    serverUrlField: Object.freeze({
      id: 'terminay-server-url',
      role: 'textbox',
      type: 'url',
      inputMode: 'url',
      label: 'Server URL',
      value: canonicalServerUrl,
      autoComplete: 'url',
      readOnly: connecting,
      required: true,
      describedBy: 'terminay-server-url-help',
      helpText: 'Use a Terminay server URL, for example https://someid.terminay.com or http://localhost:4317.',
    }),
    connectAction: Object.freeze({
      id: 'connect-server',
      label: connecting ? 'Connecting…' : 'Connect',
      disabled: connecting,
      minTouchTargetPx: CONNECTION_FORM_TOUCH_TARGET_PX,
    }),
  })
}
