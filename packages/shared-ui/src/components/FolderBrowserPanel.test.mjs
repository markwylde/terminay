import assert from 'node:assert/strict'
import test from 'node:test'
import { FOLDER_BROWSER_TOUCH_TARGET_PX, createFolderBrowserPanel } from './FolderBrowserPanel.mjs'

const entries = Object.freeze([
  Object.freeze({ id: 'entry:src', label: 'src', kind: 'folder' }),
  Object.freeze({ id: 'entry:readme', label: 'README.md', kind: 'file' }),
])

test('folder browser uses one accessible wide and narrow tree contract', () => {
  const wide = createFolderBrowserPanel({
    folderId: 'folder:root', label: 'Workspace', status: 'ready', layout: 'wide', entries, selectedEntryId: 'entry:src',
  })
  const narrow = createFolderBrowserPanel({
    folderId: 'folder:root', label: 'Workspace', status: 'ready', layout: 'narrow', entries, selectedEntryId: 'entry:src',
  })

  assert.equal(wide.role, 'region')
  assert.equal(wide.ariaLabel, 'Folder Workspace')
  assert.deepEqual(wide.statusRegion, { role: 'status', ariaLive: 'polite', ariaAtomic: true, ariaBusy: false })
  assert.deepEqual(wide.tree.items[0], {
    id: 'entry:src', label: 'src', kind: 'folder', selected: true, role: 'treeitem', ariaSelected: true,
    action: { id: 'select-folder-entry', folderId: 'folder:root', entryId: 'entry:src', label: 'Open src', minTouchTargetPx: FOLDER_BROWSER_TOUCH_TARGET_PX },
  })
  assert.equal(wide.tree.overflowX, 'visible')
  assert.equal(narrow.tree.overflowX, 'auto')
  assert.deepEqual({ ...narrow, layout: 'wide', tree: { ...narrow.tree, overflowX: 'visible' } }, wide)
})

test('folder browser distinguishes loading, empty, inaccessible, and retryable states', () => {
  const loading = createFolderBrowserPanel({ folderId: 'folder:one', label: 'one', status: 'loading', layout: 'narrow' })
  const empty = createFolderBrowserPanel({ folderId: 'folder:one', label: 'one', status: 'empty', layout: 'wide' })
  const failed = createFolderBrowserPanel({ folderId: 'folder:one', label: 'one', status: 'failed', layout: 'wide' })
  const forbidden = createFolderBrowserPanel({ folderId: 'folder:one', label: 'one', status: 'forbidden', layout: 'wide' })

  assert.equal(loading.statusRegion.ariaBusy, true)
  assert.equal(empty.statusLabel, 'Folder is empty')
  assert.deepEqual(failed.retryAction, {
    id: 'retry-folder', folderId: 'folder:one', label: 'Retry folder', minTouchTargetPx: FOLDER_BROWSER_TOUCH_TARGET_PX,
  })
  assert.equal(forbidden.retryAction, undefined)
})

test('folder browser fails closed for unsafe entries and inconsistent state', () => {
  assert.throws(
    () => createFolderBrowserPanel({ folderId: 'bad id', label: 'root', status: 'ready', layout: 'wide' }),
    /safe folder id/u,
  )
  assert.throws(
    () => createFolderBrowserPanel({ folderId: 'folder:root', label: 'root', status: 'ready', layout: 'wide', entries: [{ id: 'entry:one', label: 'bad\nname', kind: 'file' }] }),
    /safe, non-empty text/u,
  )
  assert.throws(
    () => createFolderBrowserPanel({ folderId: 'folder:root', label: 'root', status: 'loading', layout: 'wide', entries }),
    /only valid/u,
  )
  assert.throws(
    () => createFolderBrowserPanel({ folderId: 'folder:root', label: 'root', status: 'empty', layout: 'wide', entries }),
    /cannot contain entries/u,
  )
  assert.throws(
    () => createFolderBrowserPanel({ folderId: 'folder:root', label: 'root', status: 'ready', layout: 'wide', entries, selectedEntryId: 'entry:missing' }),
    /selected folder entry/u,
  )
})
