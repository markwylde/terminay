export const EDIT_TAB_ROUTE_TOUCH_TARGET_PX = 44
export const MAX_EDIT_TAB_TITLE_LENGTH = 128
export const MAX_EDIT_TAB_EMOJI_LENGTH = 32
export const MAX_EDIT_TAB_ROOT_FOLDER_LENGTH = 1_024

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/u

const STATUS_COPY = Object.freeze({
  loading: Object.freeze({ label: 'Loading tab', description: 'Loading tab settings…', busy: true, editable: false, retryable: false }),
  ready: Object.freeze({ label: 'Tab ready', description: 'Tab settings are ready to edit.', busy: false, editable: true, retryable: false }),
  saving: Object.freeze({ label: 'Saving tab', description: 'Saving tab settings…', busy: true, editable: false, retryable: false }),
  unavailable: Object.freeze({ label: 'Tab unavailable', description: 'This tab is not available for this workspace.', busy: false, editable: false, retryable: false }),
  forbidden: Object.freeze({ label: 'Tab access denied', description: 'You do not have permission to edit this tab.', busy: false, editable: false, retryable: false }),
  failed: Object.freeze({ label: 'Tab could not be loaded', description: 'Tab settings could not be loaded. Try again.', busy: false, editable: false, retryable: true }),
})

function safeId(value) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new TypeError('A safe edit-tab target id is required')
  return value
}

function safeText(value, field, maximumLength, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || value.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(value) || (!allowEmpty && value.trim().length === 0)) {
    throw new TypeError(`The edit-tab ${field} must be safe bounded text`)
  }
  return value
}

function safeColour(value, field) {
  if (typeof value !== 'string' || !HEX_COLOUR.test(value)) throw new TypeError(`The edit-tab ${field} must be a six-digit hex colour`)
  return value.toLowerCase()
}

function createField(id, label, value, maximumLength, disabled, options = {}) {
  return Object.freeze({
    id,
    role: 'textbox',
    type: options.type ?? 'text',
    label,
    value,
    maxLength: maximumLength,
    disabled,
    required: options.required === true,
    multiline: options.multiline === true || undefined,
  })
}

function createDraft(kind, draft, disabled) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw new TypeError('An edit-tab draft is required')
  const title = safeText(draft.title, 'title', MAX_EDIT_TAB_TITLE_LENGTH)
  const emoji = safeText(draft.emoji, 'emoji', MAX_EDIT_TAB_EMOJI_LENGTH, { allowEmpty: true })
  const colour = safeColour(draft.color, 'colour')
  const base = {
    title: createField('edit-tab-title', 'Name', title, MAX_EDIT_TAB_TITLE_LENGTH, disabled, { required: true }),
    emoji: createField('edit-tab-emoji', 'Icon', emoji, MAX_EDIT_TAB_EMOJI_LENGTH, disabled),
    colour: Object.freeze({ id: 'edit-tab-colour', role: 'slider', label: kind === 'project' ? 'Project theme hue' : 'Tab theme hue', value: colour, disabled }),
  }

  if (kind === 'project') {
    const rootFolder = safeText(draft.rootFolder, 'root folder', MAX_EDIT_TAB_ROOT_FOLDER_LENGTH, { allowEmpty: true })
    return Object.freeze({ ...base, rootFolder: createField('edit-tab-root-folder', 'Root Folder', rootFolder, MAX_EDIT_TAB_ROOT_FOLDER_LENGTH, disabled) })
  }
  if (typeof draft.activityIndicatorsEnabled !== 'boolean' || typeof draft.inheritsProjectColor !== 'boolean') {
    throw new TypeError('The terminal edit-tab toggles must be boolean')
  }
  const projectColour = safeColour(draft.projectColor, 'project colour')
  return Object.freeze({
    ...base,
    projectColour,
    inheritsProjectColor: draft.inheritsProjectColor,
    activityIndicatorsEnabled: Object.freeze({ id: 'edit-tab-activity-indicators', role: 'switch', label: 'Enable activity indicators', checked: draft.activityIndicatorsEnabled, disabled }),
    inheritProjectColourAction: Object.freeze({ id: 'inherit-project-colour', label: 'Inherit project colour', disabled, minTouchTargetPx: EDIT_TAB_ROUTE_TOUCH_TARGET_PX }),
  })
}

/**
 * Shared, renderer-neutral edit-tab route contract. It contains a bounded
 * project or terminal draft and declarative save/cancel/retry intents only;
 * hosts retain draft loading, persistence, window management and transport.
 */
export function createEditTabRoutePanel({ targetId, kind, draft, status, layout }) {
  const safeTargetId = safeId(targetId)
  if (kind !== 'project' && kind !== 'terminal') throw new TypeError('The edit-tab kind must be project or terminal')
  if (!Object.hasOwn(STATUS_COPY, status)) throw new TypeError('A supported edit-tab status is required')
  if (layout !== 'wide' && layout !== 'narrow') throw new TypeError('The edit-tab layout must be wide or narrow')
  const copy = STATUS_COPY[status]
  const fields = createDraft(kind, draft, !copy.editable)
  const action = (id, label) => Object.freeze({ id, targetId: safeTargetId, kind, label, minTouchTargetPx: EDIT_TAB_ROUTE_TOUCH_TARGET_PX })

  return Object.freeze({
    role: 'region',
    ariaLabel: kind === 'project' ? 'Edit Project Tab' : 'Edit Terminal Tab',
    layout,
    targetId: safeTargetId,
    kind,
    status,
    statusLabel: copy.label,
    statusDescription: copy.description,
    statusRegion: Object.freeze({ role: 'status', ariaLive: 'polite', ariaAtomic: true, ariaBusy: copy.busy }),
    form: Object.freeze({ role: 'form', ariaLabel: kind === 'project' ? 'Edit Project Tab' : 'Edit Terminal Tab', disabled: !copy.editable, fields }),
    saveAction: copy.editable ? action('save-edit-tab', 'Save tab') : undefined,
    cancelAction: (copy.editable || status === 'saving') ? action('cancel-edit-tab', 'Cancel edit') : undefined,
    retryAction: copy.retryable ? action('retry-edit-tab', 'Retry tab settings') : undefined,
  })
}
