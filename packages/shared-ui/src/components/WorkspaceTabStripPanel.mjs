export const WORKSPACE_TAB_STRIP_TOUCH_TARGET_PX = 44

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const TAB_KINDS = new Set(['terminal', 'file', 'folder'])

const STATUS_COPY = Object.freeze({
  ready: Object.freeze({ label: 'Tabs ready', description: 'Workspace tabs are ready.', busy: false, retryable: false }),
  empty: Object.freeze({ label: 'No open tabs', description: 'There are no open workspace tabs.', busy: false, retryable: false }),
  unavailable: Object.freeze({ label: 'Tabs unavailable', description: 'Workspace tabs are not available.', busy: false, retryable: false }),
  failed: Object.freeze({ label: 'Tabs could not be loaded', description: 'Workspace tabs could not be loaded. Try again.', busy: false, retryable: true }),
})

function safeId(value, field) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new TypeError(`A safe workspace ${field} is required`)
  }
  return value
}

function safeText(value, field, maximumLength = 160) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`The workspace ${field} must be safe, non-empty text`)
  }
  return value
}

/**
 * Creates the shared tab navigation contract for server-owned terminal, file,
 * and folder panels. Hosts render the same tablist above Dockview or as a
 * narrow horizontal scroller; opening and closing tabs remain host intents.
 */
export function createWorkspaceTabStripPanel({ projectId, layout, status = 'ready', tabs = [], selectedTabId }) {
  const safeProjectId = safeId(projectId, 'project id')
  if (layout !== 'wide' && layout !== 'narrow') {
    throw new TypeError('The workspace tab strip layout must be wide or narrow')
  }
  if (!Object.hasOwn(STATUS_COPY, status)) {
    throw new TypeError('A supported workspace tab strip status is required')
  }
  if (!Array.isArray(tabs) || tabs.length > 100) {
    throw new TypeError('Workspace tabs must contain at most 100 entries')
  }
  if (selectedTabId !== undefined) safeId(selectedTabId, 'selected tab id')
  if ((status === 'unavailable' || status === 'failed') && tabs.length > 0) {
    throw new TypeError('Unavailable workspace tabs cannot include entries')
  }
  if (status === 'empty' && tabs.length !== 0) {
    throw new TypeError('An empty workspace tab strip cannot include entries')
  }

  const ids = new Set()
  const safeTabs = tabs.map((tab) => {
    if (!tab || typeof tab !== 'object' || Array.isArray(tab)) {
      throw new TypeError('A workspace tab entry is required')
    }
    const id = safeId(tab.id, 'tab id')
    if (ids.has(id)) throw new TypeError('Workspace tab ids must be unique')
    ids.add(id)
    if (!TAB_KINDS.has(tab.kind)) {
      throw new TypeError('A workspace tab kind must be terminal, file, or folder')
    }
    const label = safeText(tab.label, 'tab label')
    const disabled = tab.disabled === true
    const selected = id === selectedTabId
    return Object.freeze({
      id,
      kind: tab.kind,
      label,
      selected,
      disabled,
      role: 'tab',
      ariaSelected: selected,
      ariaDisabled: disabled || undefined,
      tabIndex: selected ? 0 : -1,
      selectAction: disabled
        ? undefined
        : Object.freeze({
            id: 'select-workspace-tab',
            projectId: safeProjectId,
            tabId: id,
            label: `Open ${label}`,
            minTouchTargetPx: WORKSPACE_TAB_STRIP_TOUCH_TARGET_PX,
          }),
      closeAction: tab.closable === true
        ? Object.freeze({
            id: 'close-workspace-tab',
            projectId: safeProjectId,
            tabId: id,
            label: `Close ${label}`,
            minTouchTargetPx: WORKSPACE_TAB_STRIP_TOUCH_TARGET_PX,
          })
        : undefined,
    })
  })

  const selected = safeTabs.find((tab) => tab.selected)
  if (status === 'ready' && safeTabs.length > 0 && selectedTabId === undefined) {
    throw new TypeError('A ready workspace tab strip must identify the selected tab')
  }
  if (selectedTabId !== undefined && !selected) {
    throw new TypeError('The selected workspace tab must be present')
  }
  if (selected?.disabled) {
    throw new TypeError('The selected workspace tab cannot be disabled')
  }

  const copy = STATUS_COPY[status]
  return Object.freeze({
    role: 'region',
    ariaLabel: 'Workspace tabs',
    projectId: safeProjectId,
    layout,
    status,
    statusLabel: copy.label,
    statusDescription: copy.description,
    statusRegion: Object.freeze({ role: 'status', ariaLive: 'polite', ariaAtomic: true, ariaBusy: copy.busy }),
    tabList: Object.freeze({
      role: 'tablist',
      ariaLabel: 'Open workspace tabs',
      ariaOrientation: 'horizontal',
      overflowX: layout === 'narrow' ? 'auto' : 'visible',
      tabs: Object.freeze(safeTabs),
    }),
    retryAction: copy.retryable
      ? Object.freeze({ id: 'retry-workspace-tabs', projectId: safeProjectId, label: 'Retry workspace tabs', minTouchTargetPx: WORKSPACE_TAB_STRIP_TOUCH_TARGET_PX })
      : undefined,
  })
}
