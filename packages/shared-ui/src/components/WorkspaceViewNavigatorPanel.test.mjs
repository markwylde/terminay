import assert from 'node:assert/strict'
import test from 'node:test'
import { WORKSPACE_NAVIGATOR_TOUCH_TARGET_PX, createWorkspaceViewNavigatorPanel } from './WorkspaceViewNavigatorPanel.mjs'

const input = Object.freeze({
  projects: [{ id: 'project:alpha', label: 'Alpha' }, { id: 'project:beta', label: 'Beta' }],
  views: [{ id: 'view:workspace', label: 'Workspace' }, { id: 'view:git', label: 'Git' }],
  activeProjectId: 'project:beta',
  activeViewId: 'view:workspace',
})

test('workspace navigator shares server-owned project and view selection across layouts', () => {
  const wide = createWorkspaceViewNavigatorPanel({ ...input, layout: 'wide' })
  const narrow = createWorkspaceViewNavigatorPanel({ ...input, layout: 'narrow' })

  assert.equal(wide.role, 'navigation')
  assert.equal(wide.ariaLabel, 'Workspace navigation')
  assert.equal(wide.projectSelector.role, 'listbox')
  assert.equal(wide.projectSelector.items[1].ariaSelected, true)
  assert.deepEqual(wide.projectSelector.items[1].action, {
    id: 'select-project', projectId: 'project:beta', label: 'Select project Beta', minTouchTargetPx: WORKSPACE_NAVIGATOR_TOUCH_TARGET_PX,
  })
  assert.equal(wide.viewSelector.items[0].tabIndex, 0)
  assert.equal(wide.viewSelector.items[1].tabIndex, -1)
  assert.equal(narrow.projectSelector.ariaOrientation, 'horizontal')
  assert.equal(narrow.projectSelector.overflowX, 'auto')
  assert.equal(narrow.viewSelector.ariaOrientation, 'horizontal')
  assert.equal(narrow.viewSelector.overflowX, 'auto')
})

test('workspace navigator rejects malformed, cross-owned, duplicate, and oversized server snapshots', () => {
  assert.throws(() => createWorkspaceViewNavigatorPanel({ ...input, layout: 'medium' }), /wide or narrow/u)
  assert.throws(() => createWorkspaceViewNavigatorPanel({ ...input, activeProjectId: 'project:missing', layout: 'wide' }), /active project/u)
  assert.throws(() => createWorkspaceViewNavigatorPanel({ ...input, activeViewId: 'view:missing', layout: 'wide' }), /active view/u)
  assert.throws(() => createWorkspaceViewNavigatorPanel({ ...input, projects: [{ id: 'project:alpha', label: 'One' }, { id: 'project:alpha', label: 'Two' }], layout: 'wide' }), /unique/u)
  assert.throws(() => createWorkspaceViewNavigatorPanel({ ...input, views: Array.from({ length: 101 }, (_, index) => ({ id: `view:${index}`, label: 'View' })), layout: 'wide' }), /between one and 100/u)
  assert.throws(() => createWorkspaceViewNavigatorPanel({ ...input, projects: [{ id: 'project:alpha', label: 'bad\nlabel' }], activeProjectId: 'project:alpha', layout: 'wide' }), /safe, non-empty/u)
})
