export const FOLDER_BROWSER_TOUCH_TARGET_PX = 44

const STATUS_COPY = Object.freeze({
  loading: Object.freeze({ label: 'Loading folder', description: 'Loading folder entries…', busy: true, retryable: false }),
  ready: Object.freeze({ label: 'Folder ready', description: 'Folder entries are ready.', busy: false, retryable: false }),
  empty: Object.freeze({ label: 'Folder is empty', description: 'This folder contains no entries.', busy: false, retryable: false }),
  unavailable: Object.freeze({ label: 'Folder unavailable', description: 'This folder is not available in the workspace.', busy: false, retryable: true }),
  forbidden: Object.freeze({ label: 'Folder access denied', description: 'You do not have permission to open this folder.', busy: false, retryable: false }),
  failed: Object.freeze({ label: 'Folder could not be loaded', description: 'Folder entries could not be loaded. Try again.', busy: false, retryable: true }),
})

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

function safeText(value, field, maximumLength) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`The folder ${field} must be safe, non-empty text`)
  }
  return value
}

function safeId(value, field) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new TypeError(`A safe folder ${field} is required`)
  }
  return value
}

/**
 * Creates a host-neutral folder-browser render model. Hosts obtain entries and
 * perform navigation through their own client; this model only standardizes
 * state, accessible tree semantics, and bounded selection/retry intents.
 */
export function createFolderBrowserPanel({ folderId, label, status, layout, entries = [], selectedEntryId }) {
  const safeFolderId = safeId(folderId, 'id')
  const safeLabel = safeText(label, 'label', 256)
  if (!Object.hasOwn(STATUS_COPY, status)) {
    throw new TypeError('A supported folder status is required')
  }
  if (layout !== 'wide' && layout !== 'narrow') {
    throw new TypeError('The folder browser layout must be wide or narrow')
  }
  if (!Array.isArray(entries) || entries.length > 500) {
    throw new TypeError('Folder entries must contain at most 500 entries')
  }
  if (selectedEntryId !== undefined) safeId(selectedEntryId, 'selected entry id')
  if (status !== 'ready' && status !== 'empty' && entries.length > 0) {
    throw new TypeError('Folder entries are only valid when the folder is ready or empty')
  }
  if (status === 'empty' && entries.length !== 0) {
    throw new TypeError('An empty folder cannot contain entries')
  }

  const entryIds = new Set()
  const safeEntries = entries.map(entry => {
    if (!entry || typeof entry !== 'object') throw new TypeError('A folder entry is required')
    const id = safeId(entry.id, 'entry id')
    if (entryIds.has(id)) throw new TypeError('Folder entry ids must be unique')
    entryIds.add(id)
    if (entry.kind !== 'file' && entry.kind !== 'folder') throw new TypeError('A folder entry kind must be file or folder')
    const entryLabel = safeText(entry.label, 'entry label', 256)
    const selected = id === selectedEntryId
    return Object.freeze({
      id,
      label: entryLabel,
      kind: entry.kind,
      selected,
      role: 'treeitem',
      ariaSelected: selected,
      action: Object.freeze({
        id: 'select-folder-entry',
        folderId: safeFolderId,
        entryId: id,
        label: `Open ${entryLabel}`,
        minTouchTargetPx: FOLDER_BROWSER_TOUCH_TARGET_PX,
      }),
    })
  })
  if (selectedEntryId !== undefined && !entryIds.has(selectedEntryId)) {
    throw new TypeError('The selected folder entry must be present')
  }

  const copy = STATUS_COPY[status]
  return Object.freeze({
    role: 'region',
    ariaLabel: `Folder ${safeLabel}`,
    layout,
    folderId: safeFolderId,
    label: safeLabel,
    status,
    statusLabel: copy.label,
    statusDescription: copy.description,
    statusRegion: Object.freeze({ role: 'status', ariaLive: 'polite', ariaAtomic: true, ariaBusy: copy.busy }),
    tree: Object.freeze({
      role: 'tree',
      ariaLabel: `Entries in ${safeLabel}`,
      ariaOrientation: 'vertical',
      overflowX: layout === 'narrow' ? 'auto' : 'visible',
      items: Object.freeze(safeEntries),
    }),
    retryAction: copy.retryable
      ? Object.freeze({ id: 'retry-folder', folderId: safeFolderId, label: 'Retry folder', minTouchTargetPx: FOLDER_BROWSER_TOUCH_TARGET_PX })
      : undefined,
  })
}
