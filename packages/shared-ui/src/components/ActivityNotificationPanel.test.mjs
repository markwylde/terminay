import assert from 'node:assert/strict'
import test from 'node:test'
import { ACTIVITY_NOTIFICATION_TOUCH_TARGET_PX, createActivityNotificationPanel } from './ActivityNotificationPanel.mjs'

const notifications = [
  { id: 'agent-root', projectId: 'project-a', sessionId: 'terminal-1', label: 'Implement workspace', detail: 'Waiting for an answer', kind: 'needs-input', acknowledged: false },
  { id: 'agent-review', projectId: 'project-a', sessionId: 'terminal-2', label: 'Review changes', kind: 'completed', acknowledged: true },
  { id: 'terminal-build', projectId: 'project-b', sessionId: 'terminal-3', label: 'Build failed', kind: 'failed', acknowledged: false },
]

test('activity notifications preserve scoped acknowledgement and focus intents at wide and narrow widths', () => {
  const wide = createActivityNotificationPanel({ notifications, layout: 'wide' })
  const narrow = createActivityNotificationPanel({ notifications, layout: 'narrow' })

  assert.equal(wide.role, 'region')
  assert.equal(wide.unreadCount, 2)
  assert.equal(wide.list.role, 'list')
  assert.equal(wide.list.items[0].priority, 'high')
  assert.equal(wide.list.items[0].ariaLabel, 'Implement workspace Needs input, unacknowledged')
  assert.deepEqual(wide.list.items[0].selectAction, {
    id: 'focus-and-acknowledge-activity', notificationId: 'agent-root', projectId: 'project-a', sessionId: 'terminal-1',
    label: 'Open Implement workspace', minTouchTargetPx: ACTIVITY_NOTIFICATION_TOUCH_TARGET_PX,
  })
  assert.deepEqual(narrow.list.items, wide.list.items)
  assert.ok(wide.list.items.every(item => item.selectAction.minTouchTargetPx >= ACTIVITY_NOTIFICATION_TOUCH_TARGET_PX))
})

test('activity notifications represent an empty projection without a synthetic alert', () => {
  const panel = createActivityNotificationPanel({ notifications: [], layout: 'narrow' })
  assert.equal(panel.empty, true)
  assert.equal(panel.emptyMessage, 'No activity notifications.')
  assert.equal(panel.unreadCount, 0)
  assert.deepEqual(panel.list.items, [])
})

test('activity notifications fail closed for unsafe or ambiguous authority input', () => {
  assert.throws(() => createActivityNotificationPanel({ notifications: [{ ...notifications[0], kind: 'working' }], layout: 'wide' }), /supported kind/u)
  assert.throws(() => createActivityNotificationPanel({ notifications: [{ ...notifications[0], acknowledged: 'no' }], layout: 'wide' }), /acknowledged state/u)
  assert.throws(() => createActivityNotificationPanel({ notifications: [{ ...notifications[0], label: 'bad\nlabel' }], layout: 'wide' }), /safe label/u)
  assert.throws(() => createActivityNotificationPanel({ notifications: [notifications[0], notifications[0]], layout: 'wide' }), /ids must be unique/u)
})
