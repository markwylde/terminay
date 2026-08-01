import assert from 'node:assert/strict'
import test from 'node:test'
import { MACRO_LIBRARY_TOUCH_TARGET_PX, MAX_SHARED_MACROS, createMacroLibraryPanel } from './MacroLibraryPanel.mjs'

const macros = [
  { id: 'macro:format', label: 'Format document', detail: 'Runs the formatter' },
  { id: 'macro:test', label: 'Run tests' },
]

test('macro library panels share bounded wide and narrow contracts', () => {
  const wide = createMacroLibraryPanel({ macros, status: 'ready', layout: 'wide', selectedMacroId: 'macro:test' })
  const narrow = createMacroLibraryPanel({ macros, status: 'ready', layout: 'narrow', selectedMacroId: 'macro:test' })

  assert.equal(wide.role, 'region')
  assert.equal(wide.ariaLabel, 'Macros')
  assert.deepEqual(wide.statusRegion, { role: 'status', ariaLive: 'polite', ariaAtomic: true, ariaBusy: false })
  assert.equal(wide.list.role, 'list')
  assert.equal(wide.list.items[1].ariaCurrent, 'true')
  assert.deepEqual(wide.list.items[0].selectAction, {
    id: 'select-macro', macroId: 'macro:format', label: 'Select macro Format document', minTouchTargetPx: MACRO_LIBRARY_TOUCH_TARGET_PX,
  })
  assert.deepEqual(narrow.list.items, wide.list.items)
})

test('macro library panels distinguish loading, empty, unavailable, and retryable failed states', () => {
  const loading = createMacroLibraryPanel({ macros: [], status: 'loading', layout: 'narrow' })
  const empty = createMacroLibraryPanel({ macros: [], status: 'empty', layout: 'wide' })
  const unavailable = createMacroLibraryPanel({ macros: [], status: 'unavailable', layout: 'wide' })
  const failed = createMacroLibraryPanel({ macros: [], status: 'failed', layout: 'wide' })

  assert.equal(loading.statusRegion.ariaBusy, true)
  assert.equal(empty.empty, true)
  assert.equal(unavailable.retryAction, undefined)
  assert.deepEqual(failed.retryAction, {
    id: 'retry-macros', label: 'Retry macros', minTouchTargetPx: MACRO_LIBRARY_TOUCH_TARGET_PX,
  })
})

test('macro library panels fail closed for malformed, oversized, or cross-panel input', () => {
  assert.throws(() => createMacroLibraryPanel({ macros: [], status: 'ready', layout: 'wide' }), /must include at least one macro/u)
  assert.throws(() => createMacroLibraryPanel({ macros, status: 'empty', layout: 'wide' }), /cannot include macros/u)
  assert.throws(() => createMacroLibraryPanel({ macros: [{ id: 'macro:one', label: 'Bad\nlabel' }], status: 'ready', layout: 'wide' }), /safe, non-empty text/u)
  assert.throws(() => createMacroLibraryPanel({ macros: [macros[0], macros[0]], status: 'ready', layout: 'wide' }), /ids must be unique/u)
  assert.throws(() => createMacroLibraryPanel({ macros, status: 'ready', layout: 'wide', selectedMacroId: 'macro:missing' }), /identify a macro/u)
  assert.throws(() => createMacroLibraryPanel({ macros: Array.from({ length: MAX_SHARED_MACROS + 1 }, (_, index) => ({ id: `macro:${index}`, label: 'Macro' })), status: 'ready', layout: 'wide' }), /at most/u)
})
