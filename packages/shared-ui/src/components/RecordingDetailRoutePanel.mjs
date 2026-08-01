export const RECORDING_DETAIL_TOUCH_TARGET_PX = 44
export const MAX_RECORDING_TITLE_LENGTH = 160
export const MAX_RECORDING_DETAIL_LENGTH = 320

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

const STATUS_COPY = Object.freeze({
  loading: Object.freeze({ label: 'Loading recording', description: 'Loading recording details…', busy: true, retryable: false, available: false }),
  ready: Object.freeze({ label: 'Recording ready', description: 'Recording details are available.', busy: false, retryable: false, available: true }),
  unavailable: Object.freeze({ label: 'Recording unavailable', description: 'This recording is not available for this workspace.', busy: false, retryable: false, available: false }),
  forbidden: Object.freeze({ label: 'Recording access denied', description: 'You do not have permission to view this recording.', busy: false, retryable: false, available: false }),
  failed: Object.freeze({ label: 'Recording could not be loaded', description: 'Recording details could not be loaded. Try again.', busy: false, retryable: true, available: false }),
})

function safeId(value, field) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new TypeError(`A safe recording ${field} is required`)
  return value
}

function safeText(value, field, maximumLength) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`The recording ${field} must be safe, non-empty text`)
  }
  return value
}

/**
 * A renderer-neutral recording-detail route contract. It contains bounded
 * metadata and declarative replay/delete/back/retry intents only; persistence,
 * replay execution, authorization, host navigation, and transport stay owned
 * by the host.
 */
export function createRecordingDetailRoutePanel({ projectId, recording, status, layout }) {
  const safeProjectId = safeId(projectId, 'project id')
  if (!Object.hasOwn(STATUS_COPY, status)) throw new TypeError('A supported recording detail status is required')
  if (layout !== 'wide' && layout !== 'narrow') throw new TypeError('The recording detail layout must be wide or narrow')
  if (!recording || typeof recording !== 'object' || Array.isArray(recording)) throw new TypeError('A recording detail is required')

  const recordingId = safeId(recording.id, 'id')
  const title = safeText(recording.title, 'title', MAX_RECORDING_TITLE_LENGTH)
  const detail = recording.detail === undefined ? undefined : safeText(recording.detail, 'detail', MAX_RECORDING_DETAIL_LENGTH)
  const copy = STATUS_COPY[status]
  const target = Object.freeze({ projectId: safeProjectId, recordingId })
  const action = (id, label) => Object.freeze({ id, ...target, label, minTouchTargetPx: RECORDING_DETAIL_TOUCH_TARGET_PX })

  return Object.freeze({
    role: 'region',
    ariaLabel: `Recording ${title}`,
    layout,
    projectId: safeProjectId,
    recording: Object.freeze({ id: recordingId, title, detail }),
    status,
    statusLabel: copy.label,
    statusDescription: copy.description,
    statusRegion: Object.freeze({ role: 'status', ariaLive: 'polite', ariaAtomic: true, ariaBusy: copy.busy }),
    replayAction: copy.available ? action('replay-recording', 'Replay recording') : undefined,
    deleteAction: copy.available ? action('delete-recording', 'Delete recording') : undefined,
    backAction: action('back-to-recordings', 'Back to recordings'),
    retryAction: copy.retryable ? action('retry-recording-detail', 'Retry recording') : undefined,
  })
}
