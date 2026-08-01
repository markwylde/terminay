import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_SHARED_RECORDINGS, RECORDINGS_LIBRARY_TOUCH_TARGET_PX, createRecordingsLibraryPanel } from './RecordingsLibraryPanel.mjs'

const recordings = [
  { id: 'recording:build', title: 'Build project', detail: 'Terminay · 2 minutes ago' },
  { id: 'recording:test', title: 'Run tests' },
]

test('recordings library panels share one bounded accessible wide and narrow contract', () => {
  const wide = createRecordingsLibraryPanel({ recordings, status: 'ready', layout: 'wide', selectedRecordingId: 'recording:test' })
  const narrow = createRecordingsLibraryPanel({ recordings, status: 'ready', layout: 'narrow', selectedRecordingId: 'recording:test' })

  assert.equal(wide.role, 'region')
  assert.equal(wide.ariaLabel, 'Recordings')
  assert.deepEqual(wide.statusRegion, { role: 'status', ariaLive: 'polite', ariaAtomic: true, ariaBusy: false })
  assert.equal(wide.list.role, 'list')
  assert.equal(wide.list.items[1].ariaCurrent, 'true')
  assert.deepEqual(wide.list.items[0].selectAction, {
    id: 'select-recording', recordingId: 'recording:build', label: 'Select recording Build project', minTouchTargetPx: RECORDINGS_LIBRARY_TOUCH_TARGET_PX,
  })
  assert.deepEqual(narrow.list.items, wide.list.items)
})

test('recordings library panels distinguish loading, empty, unavailable, and retryable failed states', () => {
  const loading = createRecordingsLibraryPanel({ recordings: [], status: 'loading', layout: 'narrow' })
  const empty = createRecordingsLibraryPanel({ recordings: [], status: 'empty', layout: 'wide' })
  const unavailable = createRecordingsLibraryPanel({ recordings: [], status: 'unavailable', layout: 'wide' })
  const failed = createRecordingsLibraryPanel({ recordings: [], status: 'failed', layout: 'wide' })

  assert.equal(loading.statusRegion.ariaBusy, true)
  assert.equal(empty.empty, true)
  assert.equal(unavailable.retryAction, undefined)
  assert.deepEqual(failed.retryAction, {
    id: 'retry-recordings', label: 'Retry recordings', minTouchTargetPx: RECORDINGS_LIBRARY_TOUCH_TARGET_PX,
  })
})

test('recordings library panels fail closed for malformed, oversized, or cross-panel input', () => {
  assert.throws(() => createRecordingsLibraryPanel({ recordings: [], status: 'ready', layout: 'wide' }), /must include at least one recording/u)
  assert.throws(() => createRecordingsLibraryPanel({ recordings, status: 'empty', layout: 'wide' }), /cannot include recordings/u)
  assert.throws(() => createRecordingsLibraryPanel({ recordings: [{ id: 'recording:one', title: 'Bad\ntitle' }], status: 'ready', layout: 'wide' }), /safe, non-empty text/u)
  assert.throws(() => createRecordingsLibraryPanel({ recordings: [recordings[0], recordings[0]], status: 'ready', layout: 'wide' }), /ids must be unique/u)
  assert.throws(() => createRecordingsLibraryPanel({ recordings, status: 'ready', layout: 'wide', selectedRecordingId: 'recording:missing' }), /identify a recording/u)
  assert.throws(() => createRecordingsLibraryPanel({ recordings: Array.from({ length: MAX_SHARED_RECORDINGS + 1 }, (_, index) => ({ id: `recording:${index}`, title: 'Recording' })), status: 'ready', layout: 'wide' }), /at most/u)
})
