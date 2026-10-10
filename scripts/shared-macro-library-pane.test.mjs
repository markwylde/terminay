import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const shared = await readFile(new URL('../src/shared/SharedMacroLibraryPane.tsx', import.meta.url), 'utf8')
const desktop = await readFile(new URL('../src/components/MacrosWindow.tsx', import.meta.url), 'utf8')
const {
  groupMacroLibrary,
  moveCategory,
  moveMacroInLibrary,
  stepCategory,
  nextCategoryName,
  validCategoryName,
} = await import('../src/shared/macroLibraryGroups.ts')

test('macro library is a host-neutral shared route body', () => {
  assert.match(shared, /export function SharedMacroLibraryPane/u)
  assert.match(shared, /data-shared-route-body="macro-library"/u)
  assert.match(shared, /onCreate/u)
  assert.match(shared, /onReorder/u)
  assert.match(shared, /onMoveMacro/u)
  assert.match(shared, /onFilterChange/u)
  assert.match(shared, /onReorderCategories/u)
  assert.match(shared, /export function moveSharedMacro/u)
  assert.match(shared, /aria-keyshortcuts="Alt\+ArrowUp Alt\+ArrowDown"/u)
  assert.match(shared, /Alt\+Up Arrow and Alt\+Down Arrow/u)
  assert.doesNotMatch(shared, /window\.|electron|node:|Monaco|@monaco\/|TerminayClient|MacroDefinition/u)
})

test('shared macro keyboard reorder is bounded and immutable', () => {
  assert.match(shared, /if \(currentIndex < 0 \|\| nextIndex < 0 \|\| nextIndex >= macroIds\.length\) return macroIds/u)
  assert.match(shared, /const next = \[\.\.\.macroIds\]/u)
  assert.match(shared, /onMove\(macro\.id, event\.key === 'ArrowUp' \? -1 : 1\)/u)
  assert.match(shared, /if \(nextIds\.every\(\(id, index\) => id === macros\[index\]\?\.id\)\) return/u)
})

test('desktop macros consumes the shared library rather than owning its sidebar', () => {
  assert.match(desktop, /import \{ SharedMacroLibraryPane \}/u)
  assert.match(desktop, /<SharedMacroLibraryPane/u)
  assert.doesNotMatch(desktop, /function MacroItem\(/u)
})

const macros = [
  { id: 'a', title: 'pr:create', category: 'pr', searchText: 'Open a pull request' },
  { id: 'b', title: 'Say thing', category: '', searchText: 'Say {{message}}' },
  { id: 'c', title: 'spec:create', category: 'spec', searchText: 'draft a proposal' },
  { id: 'd', title: 'pr:green', category: 'pr', searchText: 'fix until CI passes' },
  { id: 'e', title: 'Orphan', category: 'gone', searchText: '' },
]
const shape = (groups) => groups.map((group) => [group.category, group.macros.map((macro) => macro.id)])

test('macros are grouped in category order, then those without a category', () => {
  assert.deepEqual(shape(groupMacroLibrary(macros, ['spec', 'pr'])), [
    ['spec', ['c']],
    ['pr', ['a', 'd']],
    // A macro whose category is not listed has none.
    ['', ['b', 'e']],
  ])
})

test('an empty category is listed until a filter is active', () => {
  assert.deepEqual(shape(groupMacroLibrary(macros, ['pr', 'empty', 'spec'])).map(([category]) => category), ['pr', 'empty', 'spec', ''])
  assert.deepEqual(shape(groupMacroLibrary(macros, ['pr', 'empty', 'spec'], 'create')), [
    ['pr', ['a']],
    ['spec', ['c']],
  ])
})

test('the filter matches name, category and script text', () => {
  assert.deepEqual(shape(groupMacroLibrary(macros, ['pr', 'spec'], 'CI passes')), [['pr', ['d']]])
  assert.deepEqual(shape(groupMacroLibrary(macros, ['pr', 'spec'], 'SPEC')), [['spec', ['c']]])
  assert.deepEqual(shape(groupMacroLibrary(macros, ['pr', 'spec'], '{{message}}')), [['', ['b']]])
  assert.deepEqual(groupMacroLibrary(macros, ['pr', 'spec'], 'nothing matches this'), [])
})

test('a macro dropped on a category joins it; dropped on a macro it lands just before that macro', () => {
  const joined = moveMacroInLibrary(macros, 'b', { category: 'spec' }, ['pr', 'spec'])
  assert.equal(joined.find((macro) => macro.id === 'b').category, 'spec')
  assert.deepEqual(joined.map((macro) => macro.id), ['a', 'c', 'd', 'e', 'b'])

  const before = moveMacroInLibrary(macros, 'c', { beforeMacroId: 'a' }, ['pr', 'spec'])
  assert.deepEqual(before.map((macro) => macro.id), ['c', 'a', 'b', 'd', 'e'])
  assert.equal(before[0].category, 'pr')

  // Onto a macro with no listed category: the moved macro has none either.
  assert.equal(moveMacroInLibrary(macros, 'a', { beforeMacroId: 'e' }, ['pr', 'spec']).find((macro) => macro.id === 'a').category, '')
  assert.deepEqual(moveMacroInLibrary(macros, 'missing', { category: 'pr' }, ['pr']), macros)
})

test('category names are unique ignoring case and bounded', () => {
  assert.equal(nextCategoryName([]), 'New category')
  assert.equal(nextCategoryName(['new category', 'New category 2']), 'New category 3')
  assert.equal(validCategoryName('  Release  notes ', ['pr']), 'Release notes')
  assert.equal(validCategoryName('PR', ['pr']), null)
  // Renaming a category to a different casing of itself is allowed.
  assert.equal(validCategoryName('PR', ['pr'], 'pr'), 'PR')
  assert.equal(validCategoryName('   ', ['pr']), null)
  assert.equal(validCategoryName('x'.repeat(65), []), null)
})

test('a category moves to just before or just after another, and one place at a time from the keyboard', () => {
  const categories = ['pr', 'action', 'spec']
  assert.deepEqual(moveCategory(categories, 'spec', 'pr', 'before'), ['spec', 'pr', 'action'])
  assert.deepEqual(moveCategory(categories, 'pr', 'spec', 'after'), ['action', 'spec', 'pr'])
  assert.deepEqual(moveCategory(categories, 'pr', 'action', 'after'), ['action', 'pr', 'spec'])
  assert.deepEqual(moveCategory(categories, 'action', 'spec', 'before'), categories)
  // Onto itself, or naming a category that is not listed, changes nothing.
  assert.deepEqual(moveCategory(categories, 'pr', 'pr', 'after'), categories)
  assert.deepEqual(moveCategory(categories, 'gone', 'pr', 'before'), categories)
  assert.deepEqual(moveCategory(categories, 'pr', 'gone', 'before'), categories)

  assert.deepEqual(stepCategory(categories, 'action', -1), ['action', 'pr', 'spec'])
  assert.deepEqual(stepCategory(categories, 'action', 1), ['pr', 'spec', 'action'])
  assert.deepEqual(stepCategory(categories, 'pr', -1), categories)
  assert.deepEqual(stepCategory(categories, 'spec', 1), categories)
})

test('the library groups follow the category order', () => {
  const reordered = moveCategory(['pr', 'spec'], 'spec', 'pr', 'before')
  assert.deepEqual(shape(groupMacroLibrary(macros, reordered)).map(([category]) => category), ['spec', 'pr', ''])
})
