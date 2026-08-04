import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import test from 'node:test'

const outputDirectory = await mkdtemp(join(tmpdir(), 'terminay-terminal-scrollback-interaction-'))
const outputPath = join(outputDirectory, 'terminalScrollbackInteraction.mjs')

await build({
  bundle: true,
  entryPoints: ['src/components/terminalScrollbackInteraction.ts'],
  format: 'esm',
  outfile: outputPath,
  platform: 'node',
})

const { getTerminalScrollbackAction } = await import(pathToFileURL(outputPath).href)

test.after(async () => {
  await rm(outputDirectory, { force: true, recursive: true })
})

function shortcut(overrides = {}) {
  return {
    altKey: false,
    ctrlKey: false,
    key: 'PageUp',
    metaKey: false,
    repeat: false,
    shiftKey: true,
    ...overrides,
  }
}

test('terminal scrollback claims the four unmodified Shift navigation shortcuts', () => {
  assert.equal(getTerminalScrollbackAction(shortcut()), 'page-up')
  assert.equal(getTerminalScrollbackAction(shortcut({ key: 'PageDown' })), 'page-down')
  assert.equal(getTerminalScrollbackAction(shortcut({ key: 'Home' })), 'top')
  assert.equal(getTerminalScrollbackAction(shortcut({ key: 'End' })), 'bottom')
})

test('terminal scrollback leaves repeated, modified, and unrelated shortcuts to the host or shell', () => {
  assert.equal(getTerminalScrollbackAction(shortcut({ repeat: true })), null)
  assert.equal(getTerminalScrollbackAction(shortcut({ ctrlKey: true })), null)
  assert.equal(getTerminalScrollbackAction(shortcut({ altKey: true })), null)
  assert.equal(getTerminalScrollbackAction(shortcut({ metaKey: true })), null)
  assert.equal(getTerminalScrollbackAction(shortcut({ shiftKey: false })), null)
  assert.equal(getTerminalScrollbackAction(shortcut({ key: 'ArrowUp' })), null)
})
