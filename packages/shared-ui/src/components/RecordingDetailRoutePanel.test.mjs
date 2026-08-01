import assert from 'node:assert/strict'
import test from 'node:test'
import { RECORDING_DETAIL_TOUCH_TARGET_PX, createRecordingDetailRoutePanel } from './RecordingDetailRoutePanel.mjs'

const recording = { id: 'recording:build', title: 'Build project', detail: '2 minutes ago' }
const target = { projectId: 'project:docs', recordingId: 'recording:build' }

test('recording detail shares one bounded wide and narrow route contract', () => {
  const wide = createRecordingDetailRoutePanel({ projectId: 'project:docs', recording, status: 'ready', layout: 'wide' })
  const narrow = createRecordingDetailRoutePanel({ projectId: 'project:docs', recording, status: 'ready', layout: 'narrow' })

  assert.equal(wide.role, 'region')
  assert.equal(wide.statusRegion.ariaLive, 'polite')
  assert.deepEqual(wide.replayAction, { id: 'replay-recording', ...target, label: 'Replay recording', minTouchTargetPx: RECORDING_DETAIL_TOUCH_TARGET_PX })
  assert.deepEqual(wide.deleteAction, { id: 'delete-recording', ...target, label: 'Delete recording', minTouchTargetPx: RECORDING_DETAIL_TOUCH_TARGET_PX })
  assert.deepEqual(narrow.recording, wide.recording)
})

test('recording detail distinguishes non-ready and retryable states without exposing destructive actions', () => {
  for (const status of ['loading', 'unavailable', 'forbidden']) {
    const panel = createRecordingDetailRoutePanel({ projectId: 'project:docs', recording, status, layout: 'narrow' })
    assert.equal(panel.replayAction, undefined)
    assert.equal(panel.deleteAction, undefined)
    assert.equal(panel.backAction.minTouchTargetPx, RECORDING_DETAIL_TOUCH_TARGET_PX)
  }
  const failed = createRecordingDetailRoutePanel({ projectId: 'project:docs', recording, status: 'failed', layout: 'wide' })
  assert.deepEqual(failed.retryAction, { id: 'retry-recording-detail', ...target, label: 'Retry recording', minTouchTargetPx: RECORDING_DETAIL_TOUCH_TARGET_PX })
})

test('recording detail fails closed for unsafe or malformed route data', () => {
  assert.throws(() => createRecordingDetailRoutePanel({ projectId: 'bad id', recording, status: 'ready', layout: 'wide' }), /safe recording project id/u)
  assert.throws(() => createRecordingDetailRoutePanel({ projectId: 'project:docs', recording: { ...recording, id: 'bad id' }, status: 'ready', layout: 'wide' }), /safe recording id/u)
  assert.throws(() => createRecordingDetailRoutePanel({ projectId: 'project:docs', recording: { ...recording, title: 'Bad\ntitle' }, status: 'ready', layout: 'wide' }), /safe, non-empty text/u)
  assert.throws(() => createRecordingDetailRoutePanel({ projectId: 'project:docs', recording, status: 'ready', layout: 'tablet' }), /layout/u)
})
