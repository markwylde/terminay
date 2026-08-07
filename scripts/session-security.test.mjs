import assert from 'node:assert/strict'
import test from 'node:test'

import { secureSession } from '../electron/sessionSecurity.ts'

test('shared session security is installed once and remains deny-by-default', () => {
  const listeners = []
  const trustedContents = {}
  let checks = 0
  let requests = 0
  const allowPermission = (webContents, permission, details) =>
    webContents === trustedContents &&
    permission === 'media' &&
    (details.mediaType === 'audio' || details.mediaTypes?.every((type) => type === 'audio') === true)
  const session = {
    setPermissionCheckHandler(handler) {
      checks += 1
      assert.equal(handler({}, 'camera', '', {}), false)
      assert.equal(handler(trustedContents, 'media', '', { mediaType: 'audio' }), true)
      assert.equal(handler(trustedContents, 'media', '', { mediaType: 'video' }), false)
    },
    setPermissionRequestHandler(handler) {
      requests += 1
      let allowed = true
      handler({}, 'camera', (value) => { allowed = value }, {})
      assert.equal(allowed, false)
      handler(trustedContents, 'media', (value) => { allowed = value }, { mediaTypes: ['audio'] })
      assert.equal(allowed, true)
      handler(trustedContents, 'media', (value) => { allowed = value }, { mediaTypes: ['audio', 'video'] })
      assert.equal(allowed, false)
    },
    on(event, listener) {
      assert.equal(event, 'will-download')
      listeners.push(listener)
    },
  }

  secureSession(session, allowPermission)
  secureSession(session, allowPermission)
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
