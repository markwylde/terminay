import assert from 'node:assert/strict'
import test from 'node:test'

import { secureSession } from '../electron/sessionSecurity.ts'

test('shared session security is installed once and remains deny-by-default', () => {
  const listeners = []
  let checks = 0
  let requests = 0
  const session = {
    setPermissionCheckHandler(handler) {
      checks += 1
      assert.equal(handler(), false)
    },
    setPermissionRequestHandler(handler) {
      requests += 1
      let allowed = true
      handler({}, 'camera', (value) => { allowed = value })
      assert.equal(allowed, false)
    },
    on(event, listener) {
      assert.equal(event, 'will-download')
      listeners.push(listener)
    },
  }

  secureSession(session)
  secureSession(session)
  assert.equal(checks, 1)
  assert.equal(requests, 1)
  assert.equal(listeners.length, 1)

  let prevented = false
  let cancelled = false
  listeners[0](
    { preventDefault: () => { prevented = true } },
    { cancel: () => { cancelled = true } },
  )
  assert.equal(prevented, true)
  assert.equal(cancelled, true)
})
