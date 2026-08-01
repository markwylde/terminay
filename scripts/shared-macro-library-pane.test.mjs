import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const shared = await readFile(new URL('../src/shared/SharedMacroLibraryPane.tsx', import.meta.url), 'utf8')
const desktop = await readFile(new URL('../src/components/MacrosWindow.tsx', import.meta.url), 'utf8')

test('macro library is a host-neutral shared route body', () => {
  assert.match(shared, /export function SharedMacroLibraryPane/u)
  assert.match(shared, /data-shared-route-body="macro-library"/u)
  assert.match(shared, /onCreate/u)
  assert.match(shared, /onReorder/u)
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
