import assert from 'node:assert/strict'
import test from 'node:test'
import { WORKSPACE_TAB_STRIP_TOUCH_TARGET_PX, createWorkspaceTabStripPanel } from './WorkspaceTabStripPanel.mjs'

const tabs = Object.freeze([
  Object.freeze({ id: 'tab:terminal', kind: 'terminal', label: 'Shell', closable: true }),
  Object.freeze({ id: 'tab:readme', kind: 'file', label: 'README.md', closable: true }),
  Object.freeze({ id: 'tab:src', kind: 'folder', label: 'src', disabled: true }),
])

test('workspace tab strip provides one accessible terminal/file/folder contract at wide and narrow widths', () => {
  const wide = createWorkspaceTabStripPanel({ projectId: 'project:one', layout: 'wide', tabs, selectedTabId: 'tab:terminal' })
  const narrow = createWorkspaceTabStripPanel({ projectId: 'project:one', layout: 'narrow', tabs, selectedTabId: 'tab:terminal' })

  assert.equal(wide.role, 'region')
  assert.equal(wide.ariaLabel, 'Workspace tabs')
  assert.deepEqual(wide.statusRegion, { role: 'status', ariaLive: 'polite', ariaAtomic: true, ariaBusy: false })
  assert.deepEqual(wide.tabList.tabs[0], {
    id: 'tab:terminal', kind: 'terminal', label: 'Shell', selected: true, disabled: false,
    role: 'tab', ariaSelected: true, ariaDisabled: undefined, tabIndex: 0,
    selectAction: { id: 'select-workspace-tab', projectId: 'project:one', tabId: 'tab:terminal', label: 'Open Shell', minTouchTargetPx: WORKSPACE_TAB_STRIP_TOUCH_TARGET_PX },
    closeAction: { id: 'close-workspace-tab', projectId: 'project:one', tabId: 'tab:terminal', label: 'Close Shell', minTouchTargetPx: WORKSPACE_TAB_STRIP_TOUCH_TARGET_PX },
  })
  assert.equal(wide.tabList.tabs[2].selectAction, undefined)
  assert.equal(wide.tabList.overflowX, 'visible')
  assert.equal(narrow.tabList.overflowX, 'auto')
  assert.deepEqual({ ...narrow, layout: 'wide', tabList: { ...narrow.tabList, overflowX: 'visible' } }, wide)
})

test('workspace tab strip distinguishes empty, unavailable, and retryable failure states', () => {
  const empty = createWorkspaceTabStripPanel({ projectId: 'project:one', layout: 'wide', status: 'empty' })
  const unavailable = createWorkspaceTabStripPanel({ projectId: 'project:one', layout: 'narrow', status: 'unavailable' })
  const failed = createWorkspaceTabStripPanel({ projectId: 'project:one', layout: 'wide', status: 'failed' })

  assert.equal(empty.statusLabel, 'No open tabs')
  assert.equal(unavailable.retryAction, undefined)
  assert.deepEqual(failed.retryAction, {
    id: 'retry-workspace-tabs', projectId: 'project:one', label: 'Retry workspace tabs', minTouchTargetPx: WORKSPACE_TAB_STRIP_TOUCH_TARGET_PX,
  })
})

test('workspace tab strip fails closed for inconsistent or unsafe server state', () => {
  assert.throws(
    () => createWorkspaceTabStripPanel({ projectId: 'bad id', layout: 'wide' }),
    /safe workspace project id/u,
  )
  assert.throws(
    () => createWorkspaceTabStripPanel({ projectId: 'project:one', layout: 'wide', tabs: [{ id: 'tab:one', kind: 'unknown', label: 'One' }] }),
    /tab kind/u,
  )
  assert.throws(
    () => createWorkspaceTabStripPanel({ projectId: 'project:one', layout: 'wide', tabs, selectedTabId: 'tab:src' }),
    /cannot be disabled/u,
  )
  assert.throws(
    () => createWorkspaceTabStripPanel({ projectId: 'project:one', layout: 'wide', tabs }),
    /must identify the selected/u,
  )
  assert.throws(
    () => createWorkspaceTabStripPanel({ projectId: 'project:one', layout: 'wide', status: 'failed', tabs }),
    /cannot include entries/u,
  )
  assert.throws(
    () => createWorkspaceTabStripPanel({ projectId: 'project:one', layout: 'wide', tabs: [{ id: 'tab:one', kind: 'file', label: 'bad\nlabel' }] }),
    /safe, non-empty text/u,
  )
})
