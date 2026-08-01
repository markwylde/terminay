import assert from 'node:assert/strict'
import test from 'node:test'
import { ACTIVITY_INDICATOR_TOUCH_TARGET_PX, createActivityIndicatorPanel } from './ActivityIndicatorPanel.mjs'

const indicators = [
  { tabId: 'terminal:build', projectId: 'project:app', label: 'Build', kind: 'working', unread: false },
  { tabId: 'terminal:review', projectId: 'project:app', label: 'Review', kind: 'needs-input', unread: true },
  { tabId: 'terminal:deploy', projectId: 'project:ops', label: 'Deploy', kind: 'failed', unread: true },
]

test('activity indicators preserve server-owned tab navigation at wide and narrow widths', () => {
  const wide = createActivityIndicatorPanel({ indicators, layout: 'wide' })
  const narrow = createActivityIndicatorPanel({ indicators, layout: 'narrow' })

  assert.equal(wide.role, 'region')
  assert.equal(wide.unreadCount, 2)
  assert.equal(wide.needsInputCount, 1)
  assert.equal(wide.status.text, '2 unread activity items, 1 needs input.')
  assert.deepEqual(wide.list.items[1].selectAction, {
    id: 'select-activity-tab', projectId: 'project:app', tabId: 'terminal:review',
    label: 'Open Review', minTouchTargetPx: ACTIVITY_INDICATOR_TOUCH_TARGET_PX,
  })
  assert.deepEqual(narrow.list.items, wide.list.items)
  assert.ok(wide.list.items.every(item => item.selectAction.minTouchTargetPx >= ACTIVITY_INDICATOR_TOUCH_TARGET_PX))
})

test('activity indicators retain an accessible empty projection without fabricated state', () => {
  const panel = createActivityIndicatorPanel({ indicators: [], layout: 'narrow' })
  assert.equal(panel.empty, true)
  assert.equal(panel.unreadCount, 0)
  assert.equal(panel.status.text, 'No workspace activity.')
  assert.deepEqual(panel.list.items, [])
})

test('activity indicators fail closed for ambiguous or unsafe input', () => {
  assert.throws(() => createActivityIndicatorPanel({ indicators: [{ ...indicators[0], kind: 'unknown' }], layout: 'wide' }), /supported kind/u)
  assert.throws(() => createActivityIndicatorPanel({ indicators: [{ ...indicators[0], unread: 'yes' }], layout: 'wide' }), /unread state/u)
  assert.throws(() => createActivityIndicatorPanel({ indicators: [{ ...indicators[0], label: 'Bad\nlabel' }], layout: 'wide' }), /safe label/u)
  assert.throws(() => createActivityIndicatorPanel({ indicators: [indicators[0], indicators[0]], layout: 'wide' }), /tab ids must be unique/u)
})
