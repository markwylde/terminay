import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import { bindAuxiliaryWindowLifecycle } from '../electron/auxiliaryWindowLifecycle.ts'

function fakeWindow() {
  const windowEvents = new EventEmitter()
  const contentsEvents = new EventEmitter()
  let destroyed = false
  let destroyCalls = 0
  return {
    on: (event, listener) => windowEvents.on(event, listener),
    webContents: {
      on: (event, listener) => contentsEvents.on(event, listener),
    },
    isDestroyed: () => destroyed,
    destroy() {
      destroyCalls += 1
      destroyed = true
      contentsEvents.emit('destroyed')
      windowEvents.emit('closed')
    },
    emitWindow: (event) => windowEvents.emit(event),
    emitContents: (event) => contentsEvents.emit(event),
    get destroyCalls() { return destroyCalls },
  }
}

test('native close and renderer destruction settle an auxiliary window exactly once', () => {
  const window = fakeWindow()
  let settlements = 0
  bindAuxiliaryWindowLifecycle(window, () => { settlements += 1 })

  window.emitContents('destroyed')
  window.emitWindow('closed')

  assert.equal(settlements, 1)
  assert.equal(window.destroyCalls, 0)
})

test('renderer failure settles before destroying the surviving native window', () => {
  const window = fakeWindow()
  const events = []
  bindAuxiliaryWindowLifecycle(window, () => { events.push('settled') })

  window.emitContents('render-process-gone')
  if (window.destroyCalls > 0) events.push('destroyed')

  assert.deepEqual(events, ['settled', 'destroyed'])
  assert.equal(window.destroyCalls, 1)
})

test('load rejection settles and destroys while a late close remains idempotent', async () => {
  const window = fakeWindow()
  let settlements = 0
  const lifecycle = bindAuxiliaryWindowLifecycle(window, () => { settlements += 1 })

  lifecycle.observeLoad(Promise.reject(new Error('load failed')))
  await Promise.resolve()
  window.emitWindow('closed')

  assert.equal(settlements, 1)
  assert.equal(window.destroyCalls, 1)
})
