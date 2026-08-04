export const MACRO_LIBRARY_TOUCH_TARGET_PX = 44
export const MAX_SHARED_MACROS = 100

const STATUS_COPY = Object.freeze({
  loading: Object.freeze({ label: 'Loading macros', description: 'Loading saved macros…', busy: true, retryable: false }),
  ready: Object.freeze({ label: 'Macros ready', description: 'Saved macros are available.', busy: false, retryable: false }),
  empty: Object.freeze({ label: 'No macros', description: 'No saved macros are available for this workspace.', busy: false, retryable: false }),
  unavailable: Object.freeze({ label: 'Macros unavailable', description: 'Macros are not available for this workspace.', busy: false, retryable: false }),
  failed: Object.freeze({ label: 'Macros could not be loaded', description: 'Saved macros could not be loaded. Try again.', busy: false, retryable: true }),
})

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

function requireSafeText(value, field, maximumLength) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`The macro ${field} must be safe, non-empty text`)
  }
  return value
}

function createMacroItem(macro, selectedMacroId) {
  if (!macro || typeof macro !== 'object' || Array.isArray(macro)) {
    throw new TypeError('Each macro must be an object')
  }
  if (typeof macro.id !== 'string' || !SAFE_ID.test(macro.id)) {
    throw new TypeError('A safe macro id is required')
  }
  const label = requireSafeText(macro.label, 'label', 128)
  const detail = macro.detail === undefined ? undefined : requireSafeText(macro.detail, 'detail', 240)
  const selected = macro.id === selectedMacroId
  return Object.freeze({
    id: macro.id,
    label,
    detail,
    role: 'listitem',
    ariaCurrent: selected ? 'true' : undefined,
    selectAction: Object.freeze({
      id: 'select-macro',
      macroId: macro.id,
      label: `Select macro ${label}`,
      minTouchTargetPx: MACRO_LIBRARY_TOUCH_TARGET_PX,
    }),
  })
}

/**
 * Creates the shared, host-neutral macro-library state contract. Hosts own
 * storage, editing, execution, and client calls; this model only provides the
 * bounded state and interaction semantics used by wide and narrow surfaces.
 */
export function createMacroLibraryPanel({ macros, status, layout, selectedMacroId }) {
  if (!Object.hasOwn(STATUS_COPY, status)) {
    throw new TypeError('A supported macro library status is required')
  }
  if (layout !== 'wide' && layout !== 'narrow') {
    throw new TypeError('The macro library layout must be wide or narrow')
  }
  if (!Array.isArray(macros) || macros.length > MAX_SHARED_MACROS) {
    throw new TypeError(`Macros must be an array of at most ${MAX_SHARED_MACROS} items`)
  }
  if (selectedMacroId !== undefined && (typeof selectedMacroId !== 'string' || !SAFE_ID.test(selectedMacroId))) {
    throw new TypeError('The selected macro id must be safe')
  }
  if (status === 'ready' && macros.length === 0) {
    throw new TypeError('A ready macro library must include at least one macro')
  }
  if (status === 'empty' && macros.length !== 0) {
    throw new TypeError('An empty macro library cannot include macros')
  }

  const items = macros.map(macro => createMacroItem(macro, selectedMacroId))
  const ids = new Set(items.map(item => item.id))
  if (ids.size !== items.length) {
    throw new TypeError('Macro ids must be unique')
  }
  if (selectedMacroId !== undefined && !ids.has(selectedMacroId)) {
    throw new TypeError('The selected macro id must identify a macro')
  }
  const copy = STATUS_COPY[status]
  const retryAction = copy.retryable
    ? Object.freeze({ id: 'retry-macros', label: 'Retry macros', minTouchTargetPx: MACRO_LIBRARY_TOUCH_TARGET_PX })
    : undefined

  return Object.freeze({
    role: 'region',
    ariaLabel: 'Macros',
    layout,
    status,
    statusLabel: copy.label,
    statusDescription: copy.description,
    statusRegion: Object.freeze({ role: 'status', ariaLive: 'polite', ariaAtomic: true, ariaBusy: copy.busy }),
    list: Object.freeze({ role: 'list', ariaLabel: 'Saved macros', items: Object.freeze(items) }),
    empty: status === 'empty',
    retryAction,
  })
}
