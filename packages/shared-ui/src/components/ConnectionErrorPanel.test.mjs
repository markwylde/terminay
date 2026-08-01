import assert from 'node:assert/strict'
import test from 'node:test'
import { CONNECTION_ERROR_TOUCH_TARGET_PX, createConnectionErrorPanel } from './ConnectionErrorPanel.mjs'

test('connection errors share one accessible retry surface at wide and narrow widths', () => {
  const wide = createConnectionErrorPanel({
    status: 'unreachable',
    serverLabel: 'Local server',
    layout: 'wide',
  })
  const narrow = createConnectionErrorPanel({
    status: 'unreachable',
    serverLabel: 'Local server',
    layout: 'narrow',
  })

  assert.deepEqual({
    role: wide.role,
    ariaLive: wide.ariaLive,
    ariaAtomic: wide.ariaAtomic,
    ariaLabel: wide.ariaLabel,
    title: wide.title,
    description: wide.description,
    actions: wide.actions,
  }, {
    role: 'alert',
    ariaLive: 'assertive',
    ariaAtomic: true,
    ariaLabel: 'Connection problem for Local server',
    title: 'Server is unreachable',
    description: 'Terminay could not reach this server. Check its URL and network connection, then try again.',
    actions: [
      { id: 'retry', label: 'Try again', minTouchTargetPx: CONNECTION_ERROR_TOUCH_TARGET_PX },
      { id: 'forget', label: 'Remove server', minTouchTargetPx: CONNECTION_ERROR_TOUCH_TARGET_PX },
    ],
  })
  assert.equal(wide.layout, 'wide')
  assert.equal(narrow.layout, 'narrow')
  assert.deepEqual(narrow.actions, wide.actions)
  assert.ok(narrow.actions.every(item => item.minTouchTargetPx >= 44))
})

test('connection error recovery actions distinguish temporary and credential failures', () => {
  assert.deepEqual(
    createConnectionErrorPanel({ status: 'expired', serverLabel: 'Production', layout: 'wide' }).actions.map(item => item.id),
    ['reconnect', 'forget'],
  )
  assert.deepEqual(
    createConnectionErrorPanel({ status: 'revoked', serverLabel: 'Production', layout: 'narrow' }).actions.map(item => item.id),
    ['forget'],
  )
  assert.match(
    createConnectionErrorPanel({ status: 'identity-mismatch', serverLabel: 'Production', layout: 'wide' }).description,
    /does not match/u,
  )
})

test('connection error panels reject non-error status, unsafe labels, and ambiguous layouts', () => {
  assert.throws(
    () => createConnectionErrorPanel({ status: 'connected', serverLabel: 'Production', layout: 'wide' }),
    /supported connection error/u,
  )
  assert.throws(
    () => createConnectionErrorPanel({ status: 'offline', serverLabel: 'Bad\nlabel', layout: 'wide' }),
    /safe, non-empty label/u,
  )
  assert.throws(
    () => createConnectionErrorPanel({ status: 'offline', serverLabel: 'Production', layout: 'medium' }),
    /wide or narrow/u,
  )
})
