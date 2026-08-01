export const COMMAND_SURFACE_TOUCH_TARGET_PX = 44

const STATUS_COPY = Object.freeze({
  ready: Object.freeze({ label: 'Commands ready', description: 'Commands are ready.', busy: false, retryable: false }),
  empty: Object.freeze({ label: 'No commands', description: 'No commands match this query.', busy: false, retryable: false }),
  unavailable: Object.freeze({ label: 'Commands unavailable', description: 'Commands are not available in this workspace.', busy: false, retryable: true }),
  failed: Object.freeze({ label: 'Commands could not be loaded', description: 'Commands could not be loaded. Try again.', busy: false, retryable: true }),
})

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

function safeText(value, field, maximumLength) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`The command ${field} must be safe, non-empty text`)
  }
  return value
}

function safeOptionalText(value, field, maximumLength) {
  if (value === undefined) return undefined
  return safeText(value, field, maximumLength)
}

function safeId(value, field) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new TypeError(`A safe command ${field} is required`)
  return value
}

/**
 * Produces a renderer-neutral command-surface model. The host owns command
 * discovery and execution; this package only projects safe state and intents.
 */
export function createCommandSurfacePanel({ status, layout, query = '', commands = [], selectedCommandId }) {
  if (!Object.hasOwn(STATUS_COPY, status)) throw new TypeError('A supported command surface status is required')
  if (layout !== 'wide' && layout !== 'narrow') throw new TypeError('The command surface layout must be wide or narrow')
  if (typeof query !== 'string' || query.length > 256 || /[\u0000-\u001f\u007f]/u.test(query)) {
    throw new TypeError('The command query must be safe text')
  }
  if (!Array.isArray(commands) || commands.length > 200) throw new TypeError('Commands must contain at most 200 entries')
  if (selectedCommandId !== undefined) safeId(selectedCommandId, 'selection id')
  if (status !== 'ready' && status !== 'empty' && commands.length > 0) {
    throw new TypeError('Commands are only valid when the command surface is ready or empty')
  }
  if (status === 'empty' && commands.length !== 0) throw new TypeError('An empty command surface cannot contain commands')

  const seen = new Set()
  const safeCommands = commands.map(command => {
    if (!command || typeof command !== 'object') throw new TypeError('A command is required')
    const id = safeId(command.id, 'id')
    if (seen.has(id)) throw new TypeError('Command ids must be unique')
    seen.add(id)
    const label = safeText(command.label, 'label', 256)
    const shortcut = safeOptionalText(command.shortcut, 'shortcut', 64)
    const selected = id === selectedCommandId
    return Object.freeze({
      id, label, shortcut, selected, role: 'option', ariaSelected: selected,
      action: Object.freeze({ id: 'run-command', commandId: id, label: `Run ${label}`, minTouchTargetPx: COMMAND_SURFACE_TOUCH_TARGET_PX }),
    })
  })
  if (selectedCommandId !== undefined && !seen.has(selectedCommandId)) throw new TypeError('The selected command must be present')

  const copy = STATUS_COPY[status]
  return Object.freeze({
    role: 'region', ariaLabel: 'Command surface', layout, status,
    statusLabel: copy.label, statusDescription: copy.description,
    statusRegion: Object.freeze({ role: 'status', ariaLive: 'polite', ariaAtomic: true, ariaBusy: copy.busy }),
    search: Object.freeze({ role: 'searchbox', ariaLabel: 'Search commands', value: query, maxLength: 256 }),
    commandCount: safeCommands.length,
    list: Object.freeze({ role: 'listbox', ariaLabel: 'Commands', ariaOrientation: 'vertical', overflowX: layout === 'narrow' ? 'auto' : 'visible', items: Object.freeze(safeCommands) }),
    retryAction: copy.retryable ? Object.freeze({ id: 'retry-commands', label: 'Retry commands', minTouchTargetPx: COMMAND_SURFACE_TOUCH_TARGET_PX }) : undefined,
  })
}
