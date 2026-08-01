import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import {
  bindNativeWindowCloseBarrier,
  bindSingletonWindowLifecycle,
} from '../electron/singletonWindowLifecycle.ts'

function fakeWindow() {
  const windowEvents = new EventEmitter()
  const contentsEvents = new EventEmitter()
  return {
    on: (event, listener) => windowEvents.on(event, listener),
    webContents: {
      on: (event, listener) => contentsEvents.on(event, listener),
    },
    emitWindow: (event) => windowEvents.emit(event),
    emitContents: (event) => contentsEvents.emit(event),
  }
}

test('close clears immediately and a delayed old closed event preserves its replacement', () => {
  const first = fakeWindow()
  const second = fakeWindow()
  let current = first
  const getCurrent = () => current
  const setCurrent = (value) => { current = value }

  bindSingletonWindowLifecycle(first, getCurrent, setCurrent)
  first.emitWindow('close')
  assert.equal(current, null)

  current = second
  bindSingletonWindowLifecycle(second, getCurrent, setCurrent)
  first.emitWindow('closed')
  first.emitContents('destroyed')
  assert.equal(current, second)

  second.emitContents('destroyed')
  assert.equal(current, null)
})

test('replacement barrier remains pending until native closed', async () => {
  const first = fakeWindow()
  let barrier = Promise.resolve()
  bindNativeWindowCloseBarrier(first, (next) => { barrier = next })

  first.emitWindow('close')
  let released = false
  void barrier.then(() => { released = true })
  await Promise.resolve()
  assert.equal(released, false)

  first.emitWindow('closed')
  await barrier
  assert.equal(released, true)
})

test('renderer destruction publishes and releases the replacement barrier without native closed', async () => {
  const first = fakeWindow()
  let barrier = Promise.resolve()
  bindNativeWindowCloseBarrier(first, (next) => { barrier = next })

  first.emitContents('destroyed')
  let released = false
  void barrier.then(() => { released = true })
  await Promise.resolve()
  assert.equal(released, false)

  await new Promise((resolve) => setTimeout(resolve, 5))
  await barrier
  assert.equal(released, true)
})
