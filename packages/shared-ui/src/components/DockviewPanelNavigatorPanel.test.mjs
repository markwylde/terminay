import assert from 'node:assert/strict'
import test from 'node:test'
import { DOCKVIEW_PANEL_NAVIGATOR_TOUCH_TARGET_PX, createDockviewPanelNavigatorPanel } from './DockviewPanelNavigatorPanel.mjs'

const panels = [
  { id: 'panel:terminal', label: 'Terminal', group: 'main' },
  { id: 'panel:files', label: 'Files', group: 'sidebar' },
]

test('Dockview panel navigator has one accessible wide and narrow contract', () => {
  const wide = createDockviewPanelNavigatorPanel({ projectId: 'project:terminay', layout: 'wide', panels, selectedPanelId: 'panel:terminal' })
  const narrow = createDockviewPanelNavigatorPanel({ projectId: 'project:terminay', layout: 'narrow', panels, selectedPanelId: 'panel:terminal' })

  assert.equal(wide.role, 'region')
  assert.deepEqual(wide.list, { role: 'listbox', ariaLabel: 'Workspace panels', ariaBusy: undefined })
  assert.deepEqual(wide.panels[0].selectAction, {
    id: 'select-workspace-panel', panelId: 'panel:terminal', label: 'Open Terminal', minTouchTargetPx: DOCKVIEW_PANEL_NAVIGATOR_TOUCH_TARGET_PX,
  })
  assert.equal(wide.panels[0].ariaSelected, true)
  assert.deepEqual({ ...narrow, layout: 'wide' }, wide)
})

test('Dockview panel navigator handles empty, unavailable, and retryable failure state', () => {
  const empty = createDockviewPanelNavigatorPanel({ projectId: 'project:one', layout: 'narrow', panels: [], state: 'empty' })
  const unavailable = createDockviewPanelNavigatorPanel({ projectId: 'project:one', layout: 'wide', panels: [], state: 'unavailable' })
  const failed = createDockviewPanelNavigatorPanel({ projectId: 'project:one', layout: 'wide', panels: [], state: 'failed' })

  assert.equal(empty.panels.length, 0)
  assert.equal(unavailable.retryAction, undefined)
  assert.deepEqual(failed.retryAction, {
    id: 'retry-workspace-panels', projectId: 'project:one', label: 'Retry workspace panels', minTouchTargetPx: DOCKVIEW_PANEL_NAVIGATOR_TOUCH_TARGET_PX,
  })
})

test('Dockview panel navigator fails closed for unsafe, stale, and disabled selection', () => {
  assert.throws(
    () => createDockviewPanelNavigatorPanel({ projectId: 'bad id', layout: 'wide', panels: [] }),
    /safe project id/u,
  )
  assert.throws(
    () => createDockviewPanelNavigatorPanel({ projectId: 'project:one', layout: 'wide', panels, selectedPanelId: 'panel:missing' }),
    /must be present/u,
  )
  assert.throws(
    () => createDockviewPanelNavigatorPanel({ projectId: 'project:one', layout: 'wide', panels: [{ id: 'panel:files', label: 'Files', disabled: true }], selectedPanelId: 'panel:files' }),
    /cannot be disabled/u,
  )
  assert.throws(
    () => createDockviewPanelNavigatorPanel({ projectId: 'project:one', layout: 'wide', panels: [], state: 'unknown' }),
    /supported panel navigator state/u,
  )
})
