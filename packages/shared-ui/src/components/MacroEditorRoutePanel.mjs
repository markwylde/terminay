export const MACRO_EDITOR_TOUCH_TARGET_PX = 44
export const MAX_SHARED_MACRO_LABEL_LENGTH = 128
export const MAX_SHARED_MACRO_BODY_LENGTH = 16_384

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

const STATUS_COPY = Object.freeze({
  loading: Object.freeze({ label: 'Loading macro', description: 'Loading the macro editor…', busy: true, retryable: false, editable: false }),
  ready: Object.freeze({ label: 'Macro ready', description: 'Edit the macro before saving it.', busy: false, retryable: false, editable: true }),
  saving: Object.freeze({ label: 'Saving macro', description: 'Saving macro changes…', busy: true, retryable: false, editable: false }),
  unavailable: Object.freeze({ label: 'Macro unavailable', description: 'This macro is not available for this workspace.', busy: false, retryable: false, editable: false }),
  forbidden: Object.freeze({ label: 'Macro access denied', description: 'You do not have permission to edit this macro.', busy: false, retryable: false, editable: false }),
  failed: Object.freeze({ label: 'Macro could not be loaded', description: 'The macro editor could not be loaded. Try again.', busy: false, retryable: true, editable: false }),
})

function safeId(value, field) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new TypeError(`A safe macro ${field} is required`)
  return value
}

function safeLabel(value) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_SHARED_MACRO_LABEL_LENGTH || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError('The macro label must be safe, non-empty text')
  }
  return value
}

function safeBody(value) {
  if (typeof value !== 'string' || value.length > MAX_SHARED_MACRO_BODY_LENGTH || /\u0000|\u007f/u.test(value)) {
    throw new TypeError('The macro body must be safe bounded text')
  }
  return value
}

/**
 * A shared, renderer-neutral macro editing route contract. It deliberately
 * contains only a bounded draft and declarative save/cancel/retry intents;
 * hosts own macro storage, execution, authorization and transport.
 */
export function createMacroEditorRoutePanel({ projectId, macroId, draft, status, layout }) {
  const safeProjectId = safeId(projectId, 'project id')
  if (!Object.hasOwn(STATUS_COPY, status)) throw new TypeError('A supported macro editor status is required')
  if (layout !== 'wide' && layout !== 'narrow') throw new TypeError('The macro editor layout must be wide or narrow')
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw new TypeError('A macro draft is required')
  const safeMacroId = macroId === undefined ? undefined : safeId(macroId, 'id')
  const label = safeLabel(draft.label)
  const body = safeBody(draft.body)
  const copy = STATUS_COPY[status]
  const draftModel = Object.freeze({
    label: Object.freeze({ id: 'macro-label', role: 'textbox', value: label, maxLength: MAX_SHARED_MACRO_LABEL_LENGTH, disabled: !copy.editable }),
    body: Object.freeze({ id: 'macro-body', role: 'textbox', multiline: true, value: body, maxLength: MAX_SHARED_MACRO_BODY_LENGTH, disabled: !copy.editable }),
  })
  const saveAction = copy.editable
    ? Object.freeze({ id: 'save-macro', projectId: safeProjectId, macroId: safeMacroId, label: safeMacroId ? 'Save macro' : 'Create macro', minTouchTargetPx: MACRO_EDITOR_TOUCH_TARGET_PX })
    : undefined
  const cancelAction = copy.editable || status === 'saving'
    ? Object.freeze({ id: 'cancel-macro-edit', projectId: safeProjectId, macroId: safeMacroId, label: 'Cancel macro edit', minTouchTargetPx: MACRO_EDITOR_TOUCH_TARGET_PX })
    : undefined
  const retryAction = copy.retryable
    ? Object.freeze({ id: 'retry-macro-editor', projectId: safeProjectId, macroId: safeMacroId, label: 'Retry macro editor', minTouchTargetPx: MACRO_EDITOR_TOUCH_TARGET_PX })
    : undefined

  return Object.freeze({
    role: 'region',
    ariaLabel: safeMacroId ? `Edit macro ${label}` : 'Create macro',
    layout,
    projectId: safeProjectId,
    macroId: safeMacroId,
    status,
    statusLabel: copy.label,
    statusDescription: copy.description,
    statusRegion: Object.freeze({ role: 'status', ariaLive: 'polite', ariaAtomic: true, ariaBusy: copy.busy }),
    form: Object.freeze({ role: 'form', ariaLabel: safeMacroId ? 'Macro editor' : 'New macro editor', disabled: !copy.editable, draft: draftModel }),
    saveAction,
    cancelAction,
    retryAction,
  })
}
