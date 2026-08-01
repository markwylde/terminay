export const SETTINGS_PANEL_TOUCH_TARGET_PX = 44
export const MAX_SHARED_SETTINGS_SECTIONS = 32

const STATUS_COPY = Object.freeze({
  loading: Object.freeze({ label: 'Loading settings', description: 'Loading workspace settings…', busy: true, retryable: false }),
  ready: Object.freeze({ label: 'Settings ready', description: 'Workspace settings are available.', busy: false, retryable: false }),
  unavailable: Object.freeze({ label: 'Settings unavailable', description: 'Settings are not available for this workspace.', busy: false, retryable: false }),
  forbidden: Object.freeze({ label: 'Settings access denied', description: 'You do not have permission to view these settings.', busy: false, retryable: false }),
  failed: Object.freeze({ label: 'Settings could not be loaded', description: 'Workspace settings could not be loaded. Try again.', busy: false, retryable: true }),
})

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

function requireSafeText(value, field, maximumLength) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`The settings ${field} must be safe, non-empty text`)
  }
  return value
}

function createSection(section, selectedSectionId) {
  if (!section || typeof section !== 'object' || Array.isArray(section)) {
    throw new TypeError('Each settings section must be an object')
  }
  if (typeof section.id !== 'string' || !SAFE_ID.test(section.id)) {
    throw new TypeError('A safe settings section id is required')
  }
  const label = requireSafeText(section.label, 'section label', 128)
  const description = section.description === undefined
    ? undefined
    : requireSafeText(section.description, 'section description', 240)
  const selected = section.id === selectedSectionId
  return Object.freeze({
    id: section.id,
    label,
    description,
    role: 'tab',
    ariaSelected: selected,
    tabIndex: selected ? 0 : -1,
    selectAction: Object.freeze({
      id: 'select-settings-section',
      sectionId: section.id,
      label: `Open ${label} settings`,
      minTouchTargetPx: SETTINGS_PANEL_TOUCH_TARGET_PX,
    }),
  })
}

/**
 * Creates the shared, host-neutral settings state contract. Hosts retain
 * authorization, persistence and privileged actions; this model owns only
 * bounded display state and navigation semantics for wide and narrow hosts.
 */
export function createSettingsPanel({ sections, status, layout, selectedSectionId }) {
  if (!Object.hasOwn(STATUS_COPY, status)) {
    throw new TypeError('A supported settings status is required')
  }
  if (layout !== 'wide' && layout !== 'narrow') {
    throw new TypeError('The settings layout must be wide or narrow')
  }
  if (!Array.isArray(sections) || sections.length > MAX_SHARED_SETTINGS_SECTIONS) {
    throw new TypeError(`Settings sections must be an array of at most ${MAX_SHARED_SETTINGS_SECTIONS} items`)
  }
  if (selectedSectionId !== undefined && (typeof selectedSectionId !== 'string' || !SAFE_ID.test(selectedSectionId))) {
    throw new TypeError('The selected settings section id must be safe')
  }

  const items = sections.map(section => createSection(section, selectedSectionId))
  const ids = new Set(items.map(item => item.id))
  if (ids.size !== items.length) {
    throw new TypeError('Settings section ids must be unique')
  }
  if (selectedSectionId !== undefined && !ids.has(selectedSectionId)) {
    throw new TypeError('The selected settings section id must identify a section')
  }
  const copy = STATUS_COPY[status]
  const retryAction = copy.retryable
    ? Object.freeze({ id: 'retry-settings', label: 'Retry settings', minTouchTargetPx: SETTINGS_PANEL_TOUCH_TARGET_PX })
    : undefined

  return Object.freeze({
    role: 'region',
    ariaLabel: 'Settings',
    layout,
    status,
    statusLabel: copy.label,
    statusDescription: copy.description,
    statusRegion: Object.freeze({ role: 'status', ariaLive: 'polite', ariaAtomic: true, ariaBusy: copy.busy }),
    sectionList: Object.freeze({ role: 'tablist', ariaLabel: 'Settings sections', items: Object.freeze(items) }),
    retryAction,
  })
}
