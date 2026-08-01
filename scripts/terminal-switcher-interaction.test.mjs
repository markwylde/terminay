import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import test from 'node:test'

const outputDirectory = await mkdtemp(join(tmpdir(), 'terminay-terminal-switcher-interaction-'))
const outputPath = join(outputDirectory, 'terminalSwitcherInteraction.mjs')

await build({
  bundle: true,
  entryPoints: ['src/components/terminalSwitcherInteraction.ts'],
  format: 'esm',
  outfile: outputPath,
  platform: 'node',
})

const { getTerminalSwitcherDirection } = await import(pathToFileURL(outputPath).href)

test.after(async () => {
  await rm(outputDirectory, { force: true, recursive: true })
})

function shortcut(overrides = {}) {
  return {
    altKey: true,
    ctrlKey: false,
    key: 'Tab',
    metaKey: false,
    repeat: false,
    shiftKey: false,
    ...overrides,
  }
}

test('terminal switcher claims Alt+Tab and reverses only with Shift', () => {
  assert.equal(getTerminalSwitcherDirection(shortcut()), 1)
  assert.equal(getTerminalSwitcherDirection(shortcut({ key: 'tab', shiftKey: true })), -1)
})

test('terminal switcher leaves repeated and extended-modifier chords alone', () => {
  assert.equal(getTerminalSwitcherDirection(shortcut({ repeat: true })), null)
  assert.equal(getTerminalSwitcherDirection(shortcut({ ctrlKey: true })), null)
  assert.equal(getTerminalSwitcherDirection(shortcut({ metaKey: true })), null)
  assert.equal(getTerminalSwitcherDirection(shortcut({ altKey: false })), null)
  assert.equal(getTerminalSwitcherDirection(shortcut({ key: 'Escape' })), null)
})
