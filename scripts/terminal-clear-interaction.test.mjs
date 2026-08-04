import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const outputDirectory = await mkdtemp(join(tmpdir(), 'terminay-terminal-clear-interaction-'))
const outputPath = join(outputDirectory, 'terminalClearInteraction.mjs')

await build({
  bundle: true,
  entryPoints: ['src/components/terminalClearInteraction.ts'],
  format: 'esm',
  outfile: outputPath,
  platform: 'node',
})

const { clearTerminalViewport, shouldClearTerminalForSession } = await import(pathToFileURL(outputPath).href)

test.after(async () => {
  await rm(outputDirectory, { force: true, recursive: true })
})

test('terminal clear is scoped to the exact server terminal session', () => {
  assert.equal(shouldClearTerminalForSession('terminal-a', 'terminal-a'), true)
  assert.equal(shouldClearTerminalForSession('terminal-b', 'terminal-a'), false)
  assert.equal(shouldClearTerminalForSession(undefined, 'terminal-a'), false)
  assert.equal(shouldClearTerminalForSession({ sessionId: 'terminal-a' }, 'terminal-a'), false)
})

test('terminal clear only changes the viewport and restores the exact panel focus', () => {
  const calls = []
  clearTerminalViewport({
    clear: () => calls.push('clear'),
    focus: () => calls.push('focus'),
    announceFocus: () => calls.push('announce-focus'),
  })

  assert.deepEqual(calls, ['clear', 'focus', 'announce-focus'])
})
