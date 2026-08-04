import assert from 'node:assert/strict'
import test from 'node:test'
import { MACRO_EDITOR_TOUCH_TARGET_PX, MAX_SHARED_MACRO_BODY_LENGTH, createMacroEditorRoutePanel } from './MacroEditorRoutePanel.mjs'

const draft = { label: 'Format document', body: 'npm run format\n' }

test('macro editor shares the same bounded editable contract at wide and narrow widths', () => {
  const wide = createMacroEditorRoutePanel({ projectId: 'project:docs', macroId: 'macro:format', draft, status: 'ready', layout: 'wide' })
  const narrow = createMacroEditorRoutePanel({ projectId: 'project:docs', macroId: 'macro:format', draft, status: 'ready', layout: 'narrow' })

  assert.equal(wide.role, 'region')
  assert.equal(wide.form.role, 'form')
  assert.equal(wide.form.draft.body.multiline, true)
  assert.equal(wide.form.draft.body.value, draft.body)
  assert.equal(wide.form.draft.label.disabled, false)
  assert.deepEqual(wide.saveAction, {
    id: 'save-macro', projectId: 'project:docs', macroId: 'macro:format', label: 'Save macro', minTouchTargetPx: MACRO_EDITOR_TOUCH_TARGET_PX,
  })
  assert.deepEqual(narrow.form.draft, wide.form.draft)
})

test('macro editor distinguishes loading, saving, unavailable, forbidden, and retryable failed states', () => {
  for (const status of ['loading', 'saving', 'unavailable', 'forbidden']) {
    const panel = createMacroEditorRoutePanel({ projectId: 'project:docs', draft, status, layout: 'narrow' })
    assert.equal(panel.form.disabled, true)
    assert.equal(panel.saveAction, undefined)
  }
  const saving = createMacroEditorRoutePanel({ projectId: 'project:docs', draft, status: 'saving', layout: 'wide' })
  assert.equal(saving.cancelAction.id, 'cancel-macro-edit')
  const failed = createMacroEditorRoutePanel({ projectId: 'project:docs', macroId: 'macro:format', draft, status: 'failed', layout: 'wide' })
  assert.deepEqual(failed.retryAction, {
    id: 'retry-macro-editor', projectId: 'project:docs', macroId: 'macro:format', label: 'Retry macro editor', minTouchTargetPx: MACRO_EDITOR_TOUCH_TARGET_PX,
  })
})

test('macro editor fails closed for malformed, oversized, and unsafe drafts', () => {
  assert.throws(() => createMacroEditorRoutePanel({ projectId: 'bad id', draft, status: 'ready', layout: 'wide' }), /safe macro project id/u)
  assert.throws(() => createMacroEditorRoutePanel({ projectId: 'project:docs', macroId: 'bad id', draft, status: 'ready', layout: 'wide' }), /safe macro id/u)
  assert.throws(() => createMacroEditorRoutePanel({ projectId: 'project:docs', draft: { label: 'Bad\nlabel', body: '' }, status: 'ready', layout: 'wide' }), /safe, non-empty text/u)
  assert.throws(() => createMacroEditorRoutePanel({ projectId: 'project:docs', draft: { label: 'Macro', body: 'x'.repeat(MAX_SHARED_MACRO_BODY_LENGTH + 1) }, status: 'ready', layout: 'wide' }), /safe bounded text/u)
  assert.throws(() => createMacroEditorRoutePanel({ projectId: 'project:docs', draft: { label: 'Macro', body: 'bad\u0000body' }, status: 'ready', layout: 'wide' }), /safe bounded text/u)
})
