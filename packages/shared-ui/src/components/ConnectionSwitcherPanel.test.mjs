import assert from 'node:assert/strict'
import test from 'node:test'
import { CONNECTION_SWITCHER_TOUCH_TARGET_PX, MAX_SHARED_CONNECTIONS, createConnectionSwitcherPanel } from './ConnectionSwitcherPanel.mjs'

const connections = [
  { id: 'server:local', origin: 'http://localhost:4317', label: 'Local development', status: 'connected' },
  { id: 'server:production', origin: 'https://alpha.terminay.com', label: 'Production', status: 'disconnected' },
]

test('connection switcher shares sanitized server selection across wide and narrow hosts', () => {
  const wide = createConnectionSwitcherPanel({ connections, activeConnectionId: 'server:local', layout: 'wide' })
  const narrow = createConnectionSwitcherPanel({ connections, activeConnectionId: 'server:local', layout: 'narrow' })

  assert.equal(wide.role, 'region')
  assert.equal(wide.list.role, 'listbox')
  assert.equal(wide.connections[0].ariaSelected, true)
  assert.deepEqual(wide.connections[1].activateAction, {
    id: 'activate-connection', connectionId: 'server:production', label: 'Open Production', minTouchTargetPx: CONNECTION_SWITCHER_TOUCH_TARGET_PX,
  })
  assert.deepEqual(wide.connections[1].forgetAction, {
    id: 'forget-connection', connectionId: 'server:production', label: 'Remove Production', minTouchTargetPx: CONNECTION_SWITCHER_TOUCH_TARGET_PX,
  })
  assert.equal(narrow.list.ariaOrientation, 'horizontal')
  assert.equal(narrow.list.overflowX, 'auto')
})

test('connection switcher exposes empty, unavailable, and retryable failure without a host dependency', () => {
  const empty = createConnectionSwitcherPanel({ connections: [], layout: 'narrow', status: 'empty' })
  const unavailable = createConnectionSwitcherPanel({ connections: [], layout: 'wide', status: 'unavailable' })
  const failed = createConnectionSwitcherPanel({ connections: [], layout: 'wide', status: 'failed' })

  assert.equal(empty.connections.length, 0)
  assert.equal(unavailable.retryAction, undefined)
  assert.deepEqual(failed.retryAction, { id: 'retry-connections', label: 'Retry connections', minTouchTargetPx: CONNECTION_SWITCHER_TOUCH_TARGET_PX })
})

test('connection switcher fails closed for unsafe profile metadata and stale selection', () => {
  assert.throws(() => createConnectionSwitcherPanel({ connections, activeConnectionId: 'server:missing', layout: 'wide' }), /must be present/u)
  assert.throws(() => createConnectionSwitcherPanel({ connections: [{ ...connections[0], origin: 'https://bad/path' }], activeConnectionId: 'server:local', layout: 'wide' }), /safe connection origin/u)
  assert.throws(() => createConnectionSwitcherPanel({ connections: [{ ...connections[0], label: 'Bad\nlabel' }], activeConnectionId: 'server:local', layout: 'wide' }), /safe, non-empty/u)
  assert.throws(() => createConnectionSwitcherPanel({ connections: [connections[0], { ...connections[0] }], activeConnectionId: 'server:local', layout: 'wide' }), /unique/u)
  assert.throws(() => createConnectionSwitcherPanel({ connections: [], layout: 'wide', status: 'ready' }), /must include/u)
  assert.throws(() => createConnectionSwitcherPanel({ connections, layout: 'wide', status: 'empty' }), /cannot include/u)
  assert.throws(() => createConnectionSwitcherPanel({ connections: Array.from({ length: MAX_SHARED_CONNECTIONS + 1 }, (_, index) => ({ id: `server:${index}`, origin: 'https://alpha.terminay.com', label: 'Server', status: 'connected' })), layout: 'wide' }), /at most/u)
})
