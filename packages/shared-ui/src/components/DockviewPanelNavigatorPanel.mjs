export const DOCKVIEW_PANEL_NAVIGATOR_TOUCH_TARGET_PX = 44

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

function safeText(value, field, maximumLength) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`The panel ${field} must be safe, non-empty text`)
  }
  return value
}

function panelEntry(entry, selectedPanelId) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new TypeError('Each panel entry must be an object')
  }
  if (typeof entry.id !== 'string' || !SAFE_ID.test(entry.id)) {
    throw new TypeError('Each panel id must be safe')
  }
  const label = safeText(entry.label, 'label', 128)
  const group = entry.group === undefined ? undefined : safeText(entry.group, 'group', 64)
  const disabled = entry.disabled === true
  return Object.freeze({
    id: entry.id,
    label,
    group,
    disabled,
    selected: entry.id === selectedPanelId,
    role: 'option',
    ariaSelected: entry.id === selectedPanelId,
    ariaDisabled: disabled || undefined,
    selectAction: disabled
      ? undefined
      : Object.freeze({
          id: 'select-workspace-panel',
          panelId: entry.id,
          label: `Open ${label}`,
          minTouchTargetPx: DOCKVIEW_PANEL_NAVIGATOR_TOUCH_TARGET_PX,
        }),
  })
}

/**
 * Creates the host-neutral navigation model for server-owned workspace panels
 * and sidebar entries. Hosts render this contract beside or above Dockview; it
 * intentionally does not import Dockview, a transport, or a host API.
 */
export function createDockviewPanelNavigatorPanel({ projectId, layout, panels, selectedPanelId, state = 'ready' }) {
  if (typeof projectId !== 'string' || !SAFE_ID.test(projectId)) {
    throw new TypeError('A safe project id is required')
  }
  if (layout !== 'wide' && layout !== 'narrow') {
    throw new TypeError('The panel navigator layout must be wide or narrow')
  }
  if (!['ready', 'empty', 'unavailable', 'failed'].includes(state)) {
    throw new TypeError('A supported panel navigator state is required')
  }
  if (!Array.isArray(panels) || panels.length > 100) {
    throw new TypeError('Panel entries must be a bounded array')
  }
  if (selectedPanelId !== undefined && (typeof selectedPanelId !== 'string' || !SAFE_ID.test(selectedPanelId))) {
    throw new TypeError('The selected panel id must be safe')
  }

  const entries = panels.map((entry) => panelEntry(entry, selectedPanelId))
  const selected = entries.find((entry) => entry.selected)
  if (selectedPanelId !== undefined && !selected) {
    throw new TypeError('The selected panel must be present')
  }
  if (selected?.disabled) {
    throw new TypeError('The selected panel cannot be disabled')
  }
  if (state === 'empty' && entries.length !== 0) {
    throw new TypeError('Empty panel navigation cannot include entries')
  }
  if ((state === 'unavailable' || state === 'failed') && entries.length !== 0) {
    throw new TypeError('Unavailable panel navigation cannot include entries')
  }

  const retryAction = state === 'failed'
    ? Object.freeze({ id: 'retry-workspace-panels', projectId, label: 'Retry workspace panels', minTouchTargetPx: DOCKVIEW_PANEL_NAVIGATOR_TOUCH_TARGET_PX })
    : undefined
  return Object.freeze({
    role: 'region',
    ariaLabel: 'Workspace panels',
    projectId,
    layout,
    state,
    list: Object.freeze({ role: 'listbox', ariaLabel: 'Workspace panels', ariaBusy: state === 'ready' ? undefined : state === 'failed' ? false : undefined }),
    panels: Object.freeze(entries),
    selectedPanelId,
    retryAction,
  })
}
