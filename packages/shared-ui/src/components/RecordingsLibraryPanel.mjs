export const RECORDINGS_LIBRARY_TOUCH_TARGET_PX = 44
export const MAX_SHARED_RECORDINGS = 100

const STATUS_COPY = Object.freeze({
  loading: Object.freeze({ label: 'Loading recordings', description: 'Loading saved recordings…', busy: true, retryable: false }),
  ready: Object.freeze({ label: 'Recordings ready', description: 'Saved recordings are available.', busy: false, retryable: false }),
  empty: Object.freeze({ label: 'No recordings', description: 'No saved recordings are available for this workspace.', busy: false, retryable: false }),
  unavailable: Object.freeze({ label: 'Recordings unavailable', description: 'Recordings are not available for this workspace.', busy: false, retryable: false }),
  failed: Object.freeze({ label: 'Recordings could not be loaded', description: 'Saved recordings could not be loaded. Try again.', busy: false, retryable: true }),
})

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

function requireSafeText(value, field, maximumLength) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`The recording ${field} must be safe, non-empty text`)
  }
  return value
}

function createRecordingItem(recording, selectedRecordingId) {
  if (!recording || typeof recording !== 'object' || Array.isArray(recording)) {
    throw new TypeError('Each recording must be an object')
  }
  if (typeof recording.id !== 'string' || !SAFE_ID.test(recording.id)) {
    throw new TypeError('A safe recording id is required')
  }
  const title = requireSafeText(recording.title, 'title', 160)
  const detail = recording.detail === undefined ? undefined : requireSafeText(recording.detail, 'detail', 240)
  const selected = recording.id === selectedRecordingId
  return Object.freeze({
    id: recording.id,
    title,
    detail,
    role: 'listitem',
    ariaCurrent: selected ? 'true' : undefined,
    selectAction: Object.freeze({
      id: 'select-recording',
      recordingId: recording.id,
      label: `Select recording ${title}`,
      minTouchTargetPx: RECORDINGS_LIBRARY_TOUCH_TARGET_PX,
    }),
  })
}

/**
 * Creates the shared, host-neutral recordings-library state contract. Hosts
 * own persistence, replay, deletion, and client calls; this model only gives
 * wide and narrow surfaces bounded state and interaction semantics.
 */
export function createRecordingsLibraryPanel({ recordings, status, layout, selectedRecordingId }) {
  if (!Object.hasOwn(STATUS_COPY, status)) {
    throw new TypeError('A supported recordings library status is required')
  }
  if (layout !== 'wide' && layout !== 'narrow') {
    throw new TypeError('The recordings library layout must be wide or narrow')
  }
  if (!Array.isArray(recordings) || recordings.length > MAX_SHARED_RECORDINGS) {
    throw new TypeError(`Recordings must be an array of at most ${MAX_SHARED_RECORDINGS} items`)
  }
  if (selectedRecordingId !== undefined && (typeof selectedRecordingId !== 'string' || !SAFE_ID.test(selectedRecordingId))) {
    throw new TypeError('The selected recording id must be safe')
  }
  if (status === 'ready' && recordings.length === 0) {
    throw new TypeError('A ready recordings library must include at least one recording')
  }
  if (status === 'empty' && recordings.length !== 0) {
    throw new TypeError('An empty recordings library cannot include recordings')
  }

  const items = recordings.map(recording => createRecordingItem(recording, selectedRecordingId))
  const ids = new Set(items.map(item => item.id))
  if (ids.size !== items.length) {
    throw new TypeError('Recording ids must be unique')
  }
  if (selectedRecordingId !== undefined && !ids.has(selectedRecordingId)) {
    throw new TypeError('The selected recording id must identify a recording')
  }
  const copy = STATUS_COPY[status]
  const retryAction = copy.retryable
    ? Object.freeze({ id: 'retry-recordings', label: 'Retry recordings', minTouchTargetPx: RECORDINGS_LIBRARY_TOUCH_TARGET_PX })
    : undefined

  return Object.freeze({
    role: 'region',
    ariaLabel: 'Recordings',
    layout,
    status,
    statusLabel: copy.label,
    statusDescription: copy.description,
    statusRegion: Object.freeze({ role: 'status', ariaLive: 'polite', ariaAtomic: true, ariaBusy: copy.busy }),
    list: Object.freeze({ role: 'list', ariaLabel: 'Saved recordings', items: Object.freeze(items) }),
    empty: status === 'empty',
    retryAction,
  })
}
