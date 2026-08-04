import assert from 'node:assert/strict'
import test from 'node:test'
import { DICTATION_CAPTURE_TOUCH_TARGET_PX, createDictationCapturePanel } from './DictationCapturePanel.mjs'

const target = Object.freeze({
  serverId: 'server-1', projectId: 'project-1', panelId: 'panel-1', sessionId: 'session-1', terminalLabel: 'Deploy terminal',
})

function panel(overrides = {}) {
  return createDictationCapturePanel({
    status: 'recording', layout: 'wide', requestId: 'dictation-1', target,
    destinationDisclosure: 'Audio is sent to the selected Terminay Server and configured transcription provider.',
    elapsedSeconds: 12,
    ...overrides,
  })
}

test('dictation capture has one accessible wide and narrow overlay contract with an immutable target', () => {
  const wide = panel()
  const narrow = panel({ layout: 'narrow' })

  assert.equal(wide.role, 'dialog')
  assert.equal(wide.ariaModal, true)
  assert.equal(wide.statusLabel, 'Recording dictation')
  assert.equal(wide.elapsedSeconds, 12)
  assert.deepEqual(wide.target, target)
  assert.deepEqual(wide.actions, [
    { id: 'stop-dictation', label: 'Stop dictation', minTouchTargetPx: DICTATION_CAPTURE_TOUCH_TARGET_PX },
    { id: 'cancel-dictation', label: 'Cancel dictation', minTouchTargetPx: DICTATION_CAPTURE_TOUCH_TARGET_PX },
  ])
  assert.deepEqual({ ...narrow, layout: 'wide' }, wide)
})

test('dictation capture models the full recorder lifecycle without exposing audio or provider data', () => {
  for (const status of ['requesting-permission', 'recording', 'transcribing', 'inserting', 'complete', 'cancelled']) {
    const state = panel({ status })
    assert.equal(state.status, status)
    assert.equal(state.errorMessage, undefined)
    assert.equal(state.elapsedSeconds, status === 'recording' ? 12 : undefined)
  }
  assert.deepEqual(panel({ status: 'transcribing' }).actions, [])
  assert.deepEqual(panel({ status: 'complete' }).actions, [])
  assert.deepEqual(panel({ status: 'cancelled' }).actions, [])
})

test('dictation capture exposes sanitized recoverable failures as a new capture, never an audio retry', () => {
  const failed = panel({ status: 'error', errorCode: 'provider-failed' })
  assert.equal(failed.errorMessage, 'The transcription provider could not complete dictation.')
  assert.deepEqual(failed.actions, [
    { id: 'start-new-dictation', label: 'Start new dictation', minTouchTargetPx: DICTATION_CAPTURE_TOUCH_TARGET_PX },
  ])
  assert.throws(() => panel({ status: 'error' }), /error code/u)
  assert.throws(() => panel({ status: 'recording', errorCode: 'offline' }), /only valid/u)
  assert.throws(() => panel({ target: { ...target, sessionId: 'bad id' } }), /safe identifier/u)
  assert.throws(() => panel({ elapsedSeconds: -1 }), /bounded non-negative/u)
})
