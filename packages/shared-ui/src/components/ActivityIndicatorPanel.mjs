export const ACTIVITY_INDICATOR_TOUCH_TARGET_PX = 44
export const MAX_ACTIVITY_INDICATORS = 100

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

const KIND_COPY = Object.freeze({
  working: Object.freeze({ label: 'Working', priority: 'normal' }),
  'needs-input': Object.freeze({ label: 'Needs input', priority: 'high' }),
  completed: Object.freeze({ label: 'Completed', priority: 'normal' }),
  failed: Object.freeze({ label: 'Failed', priority: 'high' }),
  idle: Object.freeze({ label: 'Idle', priority: 'normal' }),
})

function safeId(value, field) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new TypeError(`Each activity indicator requires a safe ${field}`)
  }
  return value
}

function safeLabel(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 160 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`Each activity indicator requires a safe ${field}`)
  }
  return value
}

function normalizeIndicator(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new TypeError('Each activity indicator must be an object')
  }
  if (!Object.hasOwn(KIND_COPY, entry.kind)) {
    throw new TypeError('Each activity indicator requires a supported kind')
  }
  if (typeof entry.unread !== 'boolean') {
    throw new TypeError('Each activity indicator requires unread state')
  }
  const tabId = safeId(entry.tabId, 'tab id')
  const projectId = safeId(entry.projectId, 'project id')
  const copy = KIND_COPY[entry.kind]
  return Object.freeze({
    tabId,
    projectId,
    label: safeLabel(entry.label, 'label'),
    kind: entry.kind,
    kindLabel: copy.label,
    priority: copy.priority,
    unread: entry.unread,
    ariaLabel: `${entry.label}, ${copy.label}${entry.unread ? ', unread' : ''}`,
    selectAction: Object.freeze({
      id: 'select-activity-tab',
      projectId,
      tabId,
      label: `Open ${entry.label}`,
      minTouchTargetPx: ACTIVITY_INDICATOR_TOUCH_TARGET_PX,
    }),
  })
}

/**
 * Renderer-neutral tab/header/sidebar activity projection. Hosts supply only
 * the authoritative server snapshot and perform the scoped navigation intent;
 * this contract never polls, acknowledges, or invents activity state.
 */
export function createActivityIndicatorPanel({ indicators, layout }) {
  if (layout !== 'wide' && layout !== 'narrow') {
    throw new TypeError('The activity indicator layout must be wide or narrow')
  }
  if (!Array.isArray(indicators) || indicators.length > MAX_ACTIVITY_INDICATORS) {
    throw new TypeError(`Activity indicators require at most ${MAX_ACTIVITY_INDICATORS} entries`)
  }

  const items = indicators.map(normalizeIndicator)
  if (new Set(items.map(item => item.tabId)).size !== items.length) {
    throw new TypeError('Activity indicator tab ids must be unique')
  }

  const unreadCount = items.filter(item => item.unread).length
  const needsInputCount = items.filter(item => item.kind === 'needs-input').length
  return Object.freeze({
    role: 'region',
    ariaLabel: 'Workspace activity',
    layout,
    unreadCount,
    needsInputCount,
    empty: items.length === 0,
    status: Object.freeze({
      role: 'status',
      ariaLive: 'polite',
      ariaAtomic: true,
      text: items.length === 0
        ? 'No workspace activity.'
        : `${unreadCount} unread activity item${unreadCount === 1 ? '' : 's'}${needsInputCount > 0 ? `, ${needsInputCount} need${needsInputCount === 1 ? 's' : ''} input` : ''}.`,
    }),
    list: Object.freeze({ role: 'list', ariaLabel: 'Workspace activity indicators', items: Object.freeze(items) }),
  })
}
