import assert from 'node:assert/strict'
import test from 'node:test'
import { CONNECTION_FORM_TOUCH_TARGET_PX, createConnectionFormPanel } from './ConnectionFormPanel.mjs'

test('connection form represents exactly one canonical server URL in wide and narrow layouts', () => {
  const wide = createConnectionFormPanel({ serverUrl: 'http://localhost:4317/', status: 'idle', layout: 'wide' })
  const narrow = createConnectionFormPanel({ serverUrl: 'http://localhost:4317/', status: 'idle', layout: 'narrow' })

  assert.equal(wide.ariaLabel, 'Connect to a Terminay server')
  assert.deepEqual(wide.serverUrlField, {
    id: 'terminay-server-url', role: 'textbox', type: 'url', inputMode: 'url', label: 'Server URL',
    value: 'http://localhost:4317', autoComplete: 'url', readOnly: false, required: true,
    describedBy: 'terminay-server-url-help',
    helpText: 'Use a Terminay server URL, for example https://someid.terminay.com or http://localhost:4317.',
  })
  assert.deepEqual(wide.connectAction, { id: 'connect-server', label: 'Connect', disabled: false, minTouchTargetPx: CONNECTION_FORM_TOUCH_TARGET_PX })
  assert.deepEqual({ ...narrow, layout: 'wide' }, wide)
})

test('connection form makes connecting and failure states accessible without exposing credentials', () => {
  const connecting = createConnectionFormPanel({ serverUrl: 'https://alpha.terminay.com', status: 'connecting', layout: 'narrow' })
  const failed = createConnectionFormPanel({ serverUrl: 'https://alpha.terminay.com', status: 'failed', layout: 'wide' })

  assert.equal(connecting.statusRegion.ariaBusy, true)
  assert.equal(connecting.serverUrlField.readOnly, true)
  assert.equal(connecting.connectAction.disabled, true)
  assert.deepEqual(failed.statusRegion, {
    role: 'alert', ariaLive: 'assertive', ariaAtomic: true, ariaBusy: false,
    label: 'Could not connect', description: 'The Terminay server could not be reached. Check the URL and try again.',
  })
})

test('connection form rejects credentials, paths, fragments and malformed URLs', () => {
  for (const serverUrl of ['localhost:4317', 'ftp://server.example', 'https://user:secret@server.example', 'https://server.example/path', 'https://server.example/#token', 'https://server.example/?token=secret']) {
    assert.throws(
      () => createConnectionFormPanel({ serverUrl, status: 'idle', layout: 'wide' }),
      /server URL/u,
    )
  }
})
