export const DICTATION_CAPTURE_TOUCH_TARGET_PX = 44

const MAX_TARGET_LABEL_LENGTH = 128
const MAX_DISCLOSURE_LENGTH = 240
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

const STATUS_COPY = Object.freeze({
  'requesting-permission': Object.freeze({ label: 'Requesting microphone permission', busy: true, active: true }),
  recording: Object.freeze({ label: 'Recording dictation', busy: true, active: true }),
  transcribing: Object.freeze({ label: 'Transcribing dictation', busy: true, active: false }),
  inserting: Object.freeze({ label: 'Inserting transcript', busy: true, active: false }),
  complete: Object.freeze({ label: 'Dictation complete', busy: false, active: false }),
  cancelled: Object.freeze({ label: 'Dictation cancelled', busy: false, active: false }),
  error: Object.freeze({ label: 'Dictation could not be completed', busy: false, active: false }),
})

const ERROR_COPY = Object.freeze({
  'permission-denied': 'Microphone permission was denied.',
  'microphone-unavailable': 'No microphone is available on this client.',
  'capture-failed': 'Microphone capture failed.',
  timeout: 'Dictation timed out before a transcript was available.',
  'provider-failed': 'The transcription provider could not complete dictation.',
  'invalid-credential': 'The transcription provider needs attention on this server.',
  'unsupported-audio': 'This microphone format is not supported.',
  offline: 'The selected server is unavailable.',
  revoked: 'Access to the selected server was revoked.',
  'terminal-exited': 'The selected terminal exited before dictation could be inserted.',
})

function requireSafeText(value, field, maximumLength) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`The dictation ${field} must be safe, non-empty text`)
  }
  return value
}

function requireSafeId(value, field) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new TypeError(`The dictation ${field} must be a safe identifier`)
  }
  return value
}

/**
 * Creates the renderer-neutral dictation recorder-overlay contract for both
 * browser and Desktop hosts. Capture, microphone permission, audio bytes,
 * provider credentials, and terminal writes stay outside this display model.
 */
export function createDictationCapturePanel({
  status,
  layout,
  requestId,
  target,
  destinationDisclosure,
  elapsedSeconds = 0,
  errorCode,
}) {
  if (!Object.hasOwn(STATUS_COPY, status)) {
    throw new TypeError('A supported dictation status is required')
  }
  if (layout !== 'wide' && layout !== 'narrow') {
    throw new TypeError('The dictation layout must be wide or narrow')
  }
  if (!Number.isInteger(elapsedSeconds) || elapsedSeconds < 0 || elapsedSeconds > 3_600) {
    throw new TypeError('Dictation elapsed seconds must be a bounded non-negative integer')
  }
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    throw new TypeError('A dictation target is required')
  }

  const targetContract = Object.freeze({
    serverId: requireSafeId(target.serverId, 'target server id'),
    projectId: requireSafeId(target.projectId, 'target project id'),
    panelId: requireSafeId(target.panelId, 'target panel id'),
    sessionId: requireSafeId(target.sessionId, 'target session id'),
    terminalLabel: requireSafeText(target.terminalLabel, 'target terminal label', MAX_TARGET_LABEL_LENGTH),
  })
  const disclosure = requireSafeText(destinationDisclosure, 'destination disclosure', MAX_DISCLOSURE_LENGTH)
  const copy = STATUS_COPY[status]

  if (status === 'error') {
    if (typeof errorCode !== 'string' || !Object.hasOwn(ERROR_COPY, errorCode)) {
      throw new TypeError('A supported dictation error code is required for an error state')
    }
  } else if (errorCode !== undefined) {
    throw new TypeError('A dictation error code is only valid for an error state')
  }

  const actions = []
  if (copy.active) {
    actions.push(Object.freeze({ id: 'stop-dictation', label: 'Stop dictation', minTouchTargetPx: DICTATION_CAPTURE_TOUCH_TARGET_PX }))
    actions.push(Object.freeze({ id: 'cancel-dictation', label: 'Cancel dictation', minTouchTargetPx: DICTATION_CAPTURE_TOUCH_TARGET_PX }))
  } else if (status === 'error') {
    actions.push(Object.freeze({ id: 'start-new-dictation', label: 'Start new dictation', minTouchTargetPx: DICTATION_CAPTURE_TOUCH_TARGET_PX }))
  }

  return Object.freeze({
    role: 'dialog',
    ariaModal: true,
    ariaLabel: 'Dictation',
    layout,
    requestId: requireSafeId(requestId, 'request id'),
    target: targetContract,
    destinationDisclosure: disclosure,
    status,
    statusLabel: copy.label,
    statusRegion: Object.freeze({ role: 'status', ariaLive: 'polite', ariaAtomic: true, ariaBusy: copy.busy }),
    elapsedSeconds: status === 'recording' ? elapsedSeconds : undefined,
    errorMessage: status === 'error' ? ERROR_COPY[errorCode] : undefined,
    actions: Object.freeze(actions),
  })
}
