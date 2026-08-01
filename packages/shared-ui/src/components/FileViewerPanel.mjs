export const FILE_VIEWER_TOUCH_TARGET_PX = 44

const STATUS_COPY = Object.freeze({
  loading: Object.freeze({ label: 'Loading file', description: 'Loading file contents…', busy: true, retryable: false }),
  ready: Object.freeze({ label: 'File ready', description: 'File contents are ready.', busy: false, retryable: false }),
  unavailable: Object.freeze({ label: 'File unavailable', description: 'The file is not available in this workspace.', busy: false, retryable: true }),
  forbidden: Object.freeze({ label: 'File access denied', description: 'You do not have permission to open this file.', busy: false, retryable: false }),
  failed: Object.freeze({ label: 'File could not be loaded', description: 'File contents could not be loaded. Try again.', busy: false, retryable: true }),
  deleted: Object.freeze({ label: 'File was deleted', description: 'This file no longer exists in the workspace.', busy: false, retryable: false }),
})

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

function requireSafeText(value, field, maximumLength) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`The file ${field} must be safe, non-empty text`)
  }
  return value
}

/**
 * Creates the host- and renderer-neutral state contract for one file viewer.
 * The surrounding host owns file bytes, editing, and client commands; this
 * model only makes the state, accessibility, and retry intent consistent for
 * desktop and responsive browser workspace surfaces.
 */
export function createFileViewerPanel({ fileId, label, status, layout, detail, mimeType, readOnly = false }) {
  if (typeof fileId !== 'string' || !SAFE_ID.test(fileId)) {
    throw new TypeError('A safe file id is required')
  }
  if (!Object.hasOwn(STATUS_COPY, status)) {
    throw new TypeError('A supported file status is required')
  }
  if (layout !== 'wide' && layout !== 'narrow') {
    throw new TypeError('The file viewer layout must be wide or narrow')
  }
  if (typeof readOnly !== 'boolean') {
    throw new TypeError('The file viewer read-only state must be a boolean')
  }

  const safeLabel = requireSafeText(label, 'label', 256)
  const safeDetail = detail === undefined ? undefined : requireSafeText(detail, 'detail', 240)
  const safeMimeType = mimeType === undefined ? undefined : requireSafeText(mimeType, 'MIME type', 128)
  const copy = STATUS_COPY[status]
  const retryAction = copy.retryable
    ? Object.freeze({ id: 'retry-file', fileId, label: 'Retry file', minTouchTargetPx: FILE_VIEWER_TOUCH_TARGET_PX })
    : undefined

  return Object.freeze({
    role: 'region',
    ariaLabel: `File ${safeLabel}`,
    layout,
    fileId,
    label: safeLabel,
    status,
    statusLabel: copy.label,
    statusDescription: copy.description,
    statusRegion: Object.freeze({
      role: 'status',
      ariaLive: 'polite',
      ariaAtomic: true,
      ariaBusy: copy.busy,
    }),
    contentRegion: Object.freeze({ role: 'document', ariaLive: 'off', ariaLabel: `File contents for ${safeLabel}` }),
    detail: safeDetail,
    mimeType: safeMimeType,
    readOnly,
    retryAction,
  })
}
