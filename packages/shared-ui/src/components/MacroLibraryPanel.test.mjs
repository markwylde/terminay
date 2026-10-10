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

const categorised = [
  { id: 'macro:pr', label: 'pr:create', category: 'pr', searchText: 'Open a pull request', unsaved: true },
  { id: 'macro:say', label: 'Say thing', searchText: 'Say {{message}}' },
  { id: 'macro:spec', label: 'spec:create', category: 'spec', detail: 'Draft a proposal' },
  { id: 'macro:orphan', label: 'Orphan', category: 'gone' },
]
const shape = panel => panel.groups.map(group => [group.category, [...group.itemIds]])

test('macro library panels group macros by category in category order', () => {
  const panel = createMacroLibraryPanel({ macros: categorised, status: 'ready', layout: 'wide', categories: ['spec', 'pr', 'empty'] })
  assert.deepEqual(shape(panel), [
    ['spec', ['macro:spec']],
    ['pr', ['macro:pr']],
    // An empty category is still listed so it can be filled.
    ['empty', []],
    // A macro without a listed category has none.
    ['', ['macro:say', 'macro:orphan']],
  ])
  assert.equal(panel.groups[3].label, 'No category')
  const item = id => panel.list.items.find(candidate => candidate.id === id)
  assert.equal(item('macro:pr').unsaved, true)
  assert.equal(item('macro:spec').unsaved, false)
  // The flat list is unchanged for hosts that do not group.
  assert.equal(panel.list.items.length, 4)
})

test('macro library panels are acyclic immutable data: no object is reachable twice', () => {
  const panel = createMacroLibraryPanel({ macros: categorised, status: 'ready', layout: 'wide', categories: ['spec', 'pr'] })
  const seen = new Set()
  const visit = value => {
    if (typeof value !== 'object' || value === null) return
    assert.equal(seen.has(value), false, 'an object is shared between two places in the panel')
    assert.equal(Object.isFrozen(value), true)
    seen.add(value)
    for (const child of Object.values(value)) visit(child)
  }
  visit(panel)
})

test('macro library panels without categories list every macro in one group', () => {
  const panel = createMacroLibraryPanel({ macros: categorised, status: 'ready', layout: 'narrow' })
  assert.deepEqual(shape(panel), [['', ['macro:pr', 'macro:say', 'macro:spec', 'macro:orphan']]])
})

test('macro library panels filter by label, detail, category and script text', () => {
  const filtered = filter => shape(createMacroLibraryPanel({ macros: categorised, status: 'ready', layout: 'wide', categories: ['spec', 'pr', 'empty'], filter }))
  assert.deepEqual(filtered('pull request'), [['pr', ['macro:pr']]])
  assert.deepEqual(filtered('PROPOSAL'), [['spec', ['macro:spec']]])
  assert.deepEqual(filtered('{{message}}'), [['', ['macro:say']]])
  assert.deepEqual(filtered('spec'), [['spec', ['macro:spec']]])
  assert.deepEqual(filtered('matches nothing'), [])
})

test('macro library panels fail closed for malformed categories and filters', () => {
  const build = extra => () => createMacroLibraryPanel({ macros: categorised, status: 'ready', layout: 'wide', ...extra })
  assert.throws(build({ categories: ['pr', 'PR'] }), /must be unique/u)
  assert.throws(build({ categories: [' pr'] }), /must be trimmed/u)
  assert.throws(build({ categories: ['bad\nname'] }), /safe, non-empty text/u)
  assert.throws(build({ categories: Array.from({ length: 65 }, (_, index) => `c${index}`) }), /at most/u)
  assert.throws(build({ filter: 'x'.repeat(129) }), /safe bounded text/u)
  assert.throws(() => createMacroLibraryPanel({ macros: [{ id: 'macro:one', label: 'One', category: 7 }], status: 'ready', layout: 'wide' }), /category must be text/u)
})
