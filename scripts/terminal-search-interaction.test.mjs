import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const outputDirectory = await mkdtemp(join(tmpdir(), 'terminay-terminal-search-interaction-'))
const outputPath = join(outputDirectory, 'terminalSearchInteraction.mjs')

await build({
  bundle: true,
  entryPoints: ['src/components/terminalSearchInteraction.ts'],
  format: 'esm',
  outfile: outputPath,
  platform: 'node',
})

const { isTerminalSearchShortcut } = await import(pathToFileURL(outputPath).href)

test.after(async () => {
  await rm(outputDirectory, { recursive: true, force: true })
})

function shortcut(overrides = {}) {
  return {
    altKey: false,
    ctrlKey: false,
    key: 'f',
    metaKey: false,
    shiftKey: false,
    ...overrides,
  }
}

test('terminal search uses Command+F on macOS and keeps Ctrl+F for the shell', () => {
  assert.equal(isTerminalSearchShortcut(shortcut({ metaKey: true }), { isMac: true }), true)
  assert.equal(isTerminalSearchShortcut(shortcut({ ctrlKey: true }), { isMac: true }), false)
})

test('terminal search uses Ctrl+F on non-macOS platforms and excludes modified chords', () => {
  assert.equal(isTerminalSearchShortcut(shortcut({ ctrlKey: true }), { isMac: false }), true)
  assert.equal(isTerminalSearchShortcut(shortcut({ metaKey: true }), { isMac: false }), false)
  assert.equal(isTerminalSearchShortcut(shortcut({ ctrlKey: true, metaKey: true }), { isMac: false }), false)
  assert.equal(isTerminalSearchShortcut(shortcut({ ctrlKey: true, altKey: true }), { isMac: false }), false)
  assert.equal(isTerminalSearchShortcut(shortcut({ ctrlKey: true, shiftKey: true }), { isMac: false }), false)
  assert.equal(isTerminalSearchShortcut(shortcut({ ctrlKey: true, key: 'g' }), { isMac: false }), false)
})
