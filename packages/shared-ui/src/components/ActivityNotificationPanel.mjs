export const ACTIVITY_NOTIFICATION_TOUCH_TARGET_PX = 44
export const MAX_ACTIVITY_NOTIFICATIONS = 100

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

const KIND_COPY = Object.freeze({
  'needs-input': Object.freeze({ label: 'Needs input', priority: 'high' }),
  completed: Object.freeze({ label: 'Completed', priority: 'normal' }),
  failed: Object.freeze({ label: 'Failed', priority: 'high' }),
  activity: Object.freeze({ label: 'Activity', priority: 'normal' }),
})

function safeId(value, field) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new TypeError(`Each activity notification requires a safe ${field}`)
  }
  return value
}

function safeText(value, field, maximumLength) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`Each activity notification requires safe ${field}`)
  }
  return value
}

function normalizeNotification(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new TypeError('Each activity notification must be an object')
  }
  if (!Object.hasOwn(KIND_COPY, entry.kind)) {
    throw new TypeError('Each activity notification requires a supported kind')
  }
  if (typeof entry.acknowledged !== 'boolean') {
    throw new TypeError('Each activity notification requires acknowledged state')
  }
  return Object.freeze({
    id: safeId(entry.id, 'id'),
    projectId: safeId(entry.projectId, 'project id'),
    sessionId: safeId(entry.sessionId, 'session id'),
    label: safeText(entry.label, 'label', 160),
    detail: entry.detail === undefined ? undefined : safeText(entry.detail, 'detail', 240),
    kind: entry.kind,
    acknowledged: entry.acknowledged,
  })
}

/**
 * Host and transport-neutral notification dropdown model. Hosts supply the
 * authoritative activity projection and execute the exact scoped focus/
 * acknowledgement intent; this model never fabricates terminal activity.
 */
export function createActivityNotificationPanel({ notifications, layout }) {
  if (layout !== 'wide' && layout !== 'narrow') {
    throw new TypeError('The activity notification layout must be wide or narrow')
  }
  if (!Array.isArray(notifications) || notifications.length > MAX_ACTIVITY_NOTIFICATIONS) {
    throw new TypeError(`Activity notifications require at most ${MAX_ACTIVITY_NOTIFICATIONS} entries`)
  }

  const normalized = notifications.map(normalizeNotification)
  if (new Set(normalized.map(entry => entry.id)).size !== normalized.length) {
    throw new TypeError('Activity notification ids must be unique')
  }

  const items = Object.freeze(normalized.map(entry => {
    const copy = KIND_COPY[entry.kind]
    return Object.freeze({
      ...entry,
      role: 'listitem',
      priority: copy.priority,
      kindLabel: copy.label,
      ariaLabel: `${entry.label} ${copy.label}${entry.acknowledged ? ', acknowledged' : ', unacknowledged'}`,
      selectAction: Object.freeze({
        id: 'focus-and-acknowledge-activity',
        notificationId: entry.id,
        projectId: entry.projectId,
        sessionId: entry.sessionId,
        label: `Open ${entry.label}`,
        minTouchTargetPx: ACTIVITY_NOTIFICATION_TOUCH_TARGET_PX,
      }),
    })
  }))
  const unreadCount = items.filter(entry => !entry.acknowledged).length

  return Object.freeze({
    role: 'region',
    ariaLabel: 'Activity notifications',
    layout,
    unreadCount,
    empty: items.length === 0,
    emptyMessage: items.length === 0 ? 'No activity notifications.' : undefined,
    list: Object.freeze({ role: 'list', ariaLabel: 'Activity notifications', items }),
  })
}
