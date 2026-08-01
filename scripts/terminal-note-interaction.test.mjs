import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const outputDirectory = await mkdtemp(join(tmpdir(), 'terminay-terminal-note-interaction-'))
const outputPath = join(outputDirectory, 'terminalNoteInteraction.mjs')

await build({
  bundle: true,
  entryPoints: ['src/components/terminalNoteInteraction.ts'],
  format: 'esm',
  outfile: outputPath,
  platform: 'node',
})

const { shouldReturnFocusToTerminalFromNote } = await import(pathToFileURL(outputPath).href)

test.after(async () => {
  await rm(outputDirectory, { recursive: true, force: true })
})

function keyEvent(overrides = {}) {
  return {
    altKey: false,
    ctrlKey: false,
    key: 'Escape',
    metaKey: false,
    shiftKey: false,
    ...overrides,
  }
}

test('an unmodified Escape returns note focus to its terminal', () => {
  assert.equal(shouldReturnFocusToTerminalFromNote(keyEvent()), true)
})

test('modified Escape and note text entry remain editor/host shortcuts', () => {
  assert.equal(shouldReturnFocusToTerminalFromNote(keyEvent({ altKey: true })), false)
  assert.equal(shouldReturnFocusToTerminalFromNote(keyEvent({ ctrlKey: true })), false)
  assert.equal(shouldReturnFocusToTerminalFromNote(keyEvent({ metaKey: true })), false)
  assert.equal(shouldReturnFocusToTerminalFromNote(keyEvent({ shiftKey: true })), false)
  assert.equal(shouldReturnFocusToTerminalFromNote(keyEvent({ key: 'Enter' })), false)
  assert.equal(shouldReturnFocusToTerminalFromNote(keyEvent({ key: 'a' })), false)
})
