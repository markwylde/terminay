import assert from 'node:assert/strict'
import test from 'node:test'
import { WORKSPACE_EMPTY_STATE_TOUCH_TARGET_PX, createWorkspaceEmptyStatePanel } from './WorkspaceEmptyStatePanel.mjs'

test('workspace empty states preserve one server-scoped intent at wide and narrow widths', () => {
  const wide = createWorkspaceEmptyStatePanel({ serverId: 'server:one', status: 'no-projects', layout: 'wide' })
  const narrow = createWorkspaceEmptyStatePanel({ serverId: 'server:one', status: 'no-projects', layout: 'narrow' })

  assert.deepEqual({
    role: wide.role, ariaLive: wide.ariaLive, ariaLabel: wide.ariaLabel,
    title: wide.title, description: wide.description, action: wide.action,
  }, {
    role: 'status', ariaLive: 'polite', ariaLabel: 'Workspace state',
    title: 'No projects yet', description: 'This server workspace does not contain a project yet.',
    action: { id: 'create-project', serverId: 'server:one', label: 'Create project', minTouchTargetPx: WORKSPACE_EMPTY_STATE_TOUCH_TARGET_PX },
  })
  assert.equal(narrow.layout, 'narrow')
  assert.deepEqual(narrow.action, wide.action)
  assert.ok(wide.action.minTouchTargetPx >= 44)
})

test('workspace empty states distinguish loading, unavailable, failed, and project-local no-panels state', () => {
  assert.equal(createWorkspaceEmptyStatePanel({ serverId: 'server:one', status: 'loading', layout: 'wide' }).action, null)
  const noPanels = createWorkspaceEmptyStatePanel({ serverId: 'server:one', projectId: 'project:one', status: 'no-panels', layout: 'narrow' })
  assert.deepEqual(noPanels.action, { id: 'open-view', serverId: 'server:one', projectId: 'project:one', label: 'Open workspace view', minTouchTargetPx: 44 })
  for (const status of ['unavailable', 'failed']) {
    const panel = createWorkspaceEmptyStatePanel({ serverId: 'server:one', status, layout: 'wide' })
    assert.equal(panel.role, 'alert')
    assert.equal(panel.action.id, 'retry')
  }
})

test('workspace empty states reject unsafe, contradictory, and ambiguous input', () => {
  assert.throws(() => createWorkspaceEmptyStatePanel({ serverId: 'bad id', status: 'loading', layout: 'wide' }), /safe server id/u)
  assert.throws(() => createWorkspaceEmptyStatePanel({ serverId: 'server:one', status: 'no-panels', layout: 'wide' }), /project id/u)
  assert.throws(() => createWorkspaceEmptyStatePanel({ serverId: 'server:one', projectId: 'project:one', status: 'no-projects', layout: 'wide' }), /cannot include/u)
  assert.throws(() => createWorkspaceEmptyStatePanel({ serverId: 'server:one', status: 'loading', layout: 'medium' }), /wide or narrow/u)
})
