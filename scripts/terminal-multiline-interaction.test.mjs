import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const outputDirectory = await mkdtemp(join(tmpdir(), 'terminay-terminal-multiline-interaction-'))
const outputPath = join(outputDirectory, 'terminalMultilineInteraction.mjs')

await build({
  bundle: true,
  entryPoints: ['src/components/terminalMultilineInteraction.ts'],
  format: 'esm',
  outfile: outputPath,
  platform: 'node',
})

const { shouldInsertTerminalMultilineNewline } = await import(pathToFileURL(outputPath).href)

test.after(async () => {
  await rm(outputDirectory, { force: true, recursive: true })
})

function shortcut(overrides = {}) {
  return {
    altKey: false,
    ctrlKey: false,
    key: 'Enter',
    metaKey: false,
    repeat: false,
    shiftKey: false,
    ...overrides,
  }
}

test('terminal multiline entry claims only Shift+Enter or Alt+Enter', () => {
  assert.equal(shouldInsertTerminalMultilineNewline(shortcut({ shiftKey: true })), true)
  assert.equal(shouldInsertTerminalMultilineNewline(shortcut({ altKey: true })), true)
})

test('terminal multiline entry leaves ordinary, repeated, and extended chords to their owners', () => {
  assert.equal(shouldInsertTerminalMultilineNewline(shortcut()), false)
  assert.equal(shouldInsertTerminalMultilineNewline(shortcut({ altKey: true, shiftKey: true })), false)
  assert.equal(shouldInsertTerminalMultilineNewline(shortcut({ ctrlKey: true, shiftKey: true })), false)
  assert.equal(shouldInsertTerminalMultilineNewline(shortcut({ metaKey: true, altKey: true })), false)
  assert.equal(shouldInsertTerminalMultilineNewline(shortcut({ repeat: true, shiftKey: true })), false)
  assert.equal(shouldInsertTerminalMultilineNewline(shortcut({ key: 'N', shiftKey: true })), false)
})
