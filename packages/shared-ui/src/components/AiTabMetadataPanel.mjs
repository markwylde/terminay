export const AI_TAB_METADATA_TOUCH_TARGET_PX = 44

const STATUS_COPY = Object.freeze({
  loading: Object.freeze({ label: 'Generating tab metadata', description: 'Generating a title, icon, and colour…', busy: true, retryable: false }),
  ready: Object.freeze({ label: 'Tab metadata ready', description: 'This tab metadata is ready.', busy: false, retryable: false }),
  unavailable: Object.freeze({ label: 'Tab metadata unavailable', description: 'AI tab metadata is unavailable for this server.', busy: false, retryable: true }),
  failed: Object.freeze({ label: 'Tab metadata could not be generated', description: 'Tab metadata could not be generated. Try again.', busy: false, retryable: true }),
  disabled: Object.freeze({ label: 'Tab metadata is disabled', description: 'AI tab metadata is disabled for this workspace.', busy: false, retryable: false }),
})

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const SAFE_ICON = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$/u
const SAFE_COLOUR = /^#[0-9a-fA-F]{6}$/u

function requireSafeText(value, field, maximumLength) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`AI tab metadata requires safe ${field}`)
  }
  return value
}

function normalizeMetadata(metadata) {
  if (metadata === undefined) return undefined
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new TypeError('AI tab metadata must be an object')
  }
  const title = requireSafeText(metadata.title, 'title', 120)
  const icon = metadata.icon === undefined ? undefined : metadata.icon
  const colour = metadata.colour === undefined ? undefined : metadata.colour
  if (icon !== undefined && (typeof icon !== 'string' || !SAFE_ICON.test(icon))) {
    throw new TypeError('AI tab metadata icon must be safe')
  }
  if (colour !== undefined && (typeof colour !== 'string' || !SAFE_COLOUR.test(colour))) {
    throw new TypeError('AI tab metadata colour must be a six-digit hex colour')
  }
  return Object.freeze({ title, icon, colour: colour?.toLowerCase() })
}

/**
 * Host- and transport-neutral state contract for generated tab metadata.
 * The host owns the AI provider, credentials, persistence, and mutation;
 * this shared model only describes bounded metadata, accessible status, and
 * a safe retry intent for desktop and browser routes.
 */
export function createAiTabMetadataPanel({ tabId, tabLabel, status, layout, metadata, detail }) {
  if (typeof tabId !== 'string' || !SAFE_ID.test(tabId)) {
    throw new TypeError('AI tab metadata requires a safe tab id')
  }
  if (!Object.hasOwn(STATUS_COPY, status)) {
    throw new TypeError('AI tab metadata requires a supported status')
  }
  if (layout !== 'wide' && layout !== 'narrow') {
    throw new TypeError('AI tab metadata layout must be wide or narrow')
  }
  const safeTabLabel = requireSafeText(tabLabel, 'tab label', 160)
  const safeDetail = detail === undefined ? undefined : requireSafeText(detail, 'detail', 240)
  const normalizedMetadata = normalizeMetadata(metadata)
  if (status === 'ready' && normalizedMetadata === undefined) {
    throw new TypeError('Ready AI tab metadata requires metadata')
  }
  if (status !== 'ready' && normalizedMetadata !== undefined) {
    throw new TypeError('Only ready AI tab metadata may include metadata')
  }

  const copy = STATUS_COPY[status]
  return Object.freeze({
    role: 'region',
    ariaLabel: `AI tab metadata for ${safeTabLabel}`,
    layout,
    tabId,
    tabLabel: safeTabLabel,
    status,
    statusLabel: copy.label,
    statusDescription: copy.description,
    detail: safeDetail,
    metadata: normalizedMetadata,
    statusRegion: Object.freeze({
      role: 'status',
      ariaLive: 'polite',
      ariaAtomic: true,
      ariaBusy: copy.busy,
    }),
    regenerateAction: copy.retryable
      ? Object.freeze({ id: 'regenerate-tab-metadata', tabId, label: 'Try again', minTouchTargetPx: AI_TAB_METADATA_TOUCH_TARGET_PX })
      : undefined,
  })
}
