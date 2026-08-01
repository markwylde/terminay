import assert from 'node:assert/strict'
import test from 'node:test'
import { EDIT_TAB_ROUTE_TOUCH_TARGET_PX, MAX_EDIT_TAB_TITLE_LENGTH, createEditTabRoutePanel } from './EditTabRoutePanel.mjs'

const projectDraft = Object.freeze({ title: 'Documentation', emoji: '📚', color: '#4f9dff', rootFolder: '/workspace/docs' })
const terminalDraft = Object.freeze({ title: 'Build shell', emoji: '⚡', color: '#4f9dff', projectColor: '#228b66', inheritsProjectColor: false, activityIndicatorsEnabled: true })

test('edit-tab route panel provides one bounded project and terminal contract at wide and narrow widths', () => {
  const project = createEditTabRoutePanel({ targetId: 'project:docs', kind: 'project', draft: projectDraft, status: 'ready', layout: 'wide' })
  const narrowTerminal = createEditTabRoutePanel({ targetId: 'panel:shell', kind: 'terminal', draft: terminalDraft, status: 'ready', layout: 'narrow' })

  assert.equal(project.role, 'region')
  assert.equal(project.ariaLabel, 'Edit Project Tab')
  assert.deepEqual(project.form.fields.rootFolder, { id: 'edit-tab-root-folder', role: 'textbox', type: 'text', label: 'Root Folder', value: '/workspace/docs', maxLength: 1024, disabled: false, required: false, multiline: undefined })
  assert.deepEqual(project.saveAction, { id: 'save-edit-tab', targetId: 'project:docs', kind: 'project', label: 'Save tab', minTouchTargetPx: EDIT_TAB_ROUTE_TOUCH_TARGET_PX })
  assert.equal(narrowTerminal.form.fields.projectColour, '#228b66')
  assert.deepEqual(narrowTerminal.form.fields.inheritProjectColourAction, { id: 'inherit-project-colour', label: 'Inherit project colour', disabled: false, minTouchTargetPx: EDIT_TAB_ROUTE_TOUCH_TARGET_PX })
  assert.deepEqual(narrowTerminal.form.fields.activityIndicatorsEnabled, { id: 'edit-tab-activity-indicators', role: 'switch', label: 'Enable activity indicators', checked: true, disabled: false })
})

test('edit-tab route panel exposes accessible loading, saving, unavailable, forbidden and retryable states', () => {
  for (const status of ['loading', 'unavailable', 'forbidden']) {
    const panel = createEditTabRoutePanel({ targetId: 'project:docs', kind: 'project', draft: projectDraft, status, layout: 'wide' })
    assert.equal(panel.form.disabled, true)
    assert.equal(panel.saveAction, undefined)
    assert.equal(panel.retryAction, undefined)
  }
  const saving = createEditTabRoutePanel({ targetId: 'panel:shell', kind: 'terminal', draft: terminalDraft, status: 'saving', layout: 'wide' })
  const failed = createEditTabRoutePanel({ targetId: 'panel:shell', kind: 'terminal', draft: terminalDraft, status: 'failed', layout: 'narrow' })
  assert.equal(saving.statusRegion.ariaBusy, true)
  assert.equal(saving.cancelAction.id, 'cancel-edit-tab')
  assert.deepEqual(failed.retryAction, { id: 'retry-edit-tab', targetId: 'panel:shell', kind: 'terminal', label: 'Retry tab settings', minTouchTargetPx: EDIT_TAB_ROUTE_TOUCH_TARGET_PX })
})

test('edit-tab route panel rejects unsafe identity, drafts, colours, and incompatible variants', () => {
  assert.throws(() => createEditTabRoutePanel({ targetId: 'bad id', kind: 'project', draft: projectDraft, status: 'ready', layout: 'wide' }), /target id/u)
  assert.throws(() => createEditTabRoutePanel({ targetId: 'project:docs', kind: 'project', draft: { ...projectDraft, title: 'x'.repeat(MAX_EDIT_TAB_TITLE_LENGTH + 1) }, status: 'ready', layout: 'wide' }), /safe bounded text/u)
  assert.throws(() => createEditTabRoutePanel({ targetId: 'project:docs', kind: 'project', draft: { ...projectDraft, color: 'red' }, status: 'ready', layout: 'wide' }), /hex colour/u)
  assert.throws(() => createEditTabRoutePanel({ targetId: 'panel:shell', kind: 'terminal', draft: { ...terminalDraft, activityIndicatorsEnabled: 'yes' }, status: 'ready', layout: 'wide' }), /must be boolean/u)
  assert.throws(() => createEditTabRoutePanel({ targetId: 'project:docs', kind: 'file', draft: projectDraft, status: 'ready', layout: 'wide' }), /project or terminal/u)
})
