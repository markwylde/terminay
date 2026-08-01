import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const outputDirectory = await mkdtemp(join(tmpdir(), 'terminay-terminal-exit-interaction-'))
const outputPath = join(outputDirectory, 'terminalExitInteraction.mjs')

await build({
  bundle: true,
  entryPoints: ['src/components/terminalExitInteraction.ts'],
  format: 'esm',
  outfile: outputPath,
  platform: 'node',
})

const { formatTerminalExitNotice, shouldSuppressTerminalExitNotice } = await import(pathToFileURL(outputPath).href)

test.after(async () => {
  await rm(outputDirectory, { recursive: true, force: true })
})

test('a configured successful normal exit does not leave a failure notice', () => {
  const exit = { autoCloseOnSuccessfulExit: true, exitCode: 0, signal: null }
  assert.equal(shouldSuppressTerminalExitNotice(exit), true)
  assert.equal(formatTerminalExitNotice(exit), null)
})

test('failed and signalled exits retain an exact visible terminal notice', () => {
  assert.equal(
    formatTerminalExitNotice({ autoCloseOnSuccessfulExit: true, exitCode: 1, signal: null }),
    '\r\n\x1b[31m[process exited with code 1]\x1b[0m\r\n',
  )
  assert.equal(
    formatTerminalExitNotice({ autoCloseOnSuccessfulExit: false, exitCode: 143, signal: 15 }),
    '\r\n\x1b[31m[process exited with signal 15 (code 143)]\x1b[0m\r\n',
  )
})

test('malformed runtime exit metadata cannot render NaN or infinity into xterm', () => {
  assert.equal(
    formatTerminalExitNotice({ autoCloseOnSuccessfulExit: false, exitCode: Number.NaN, signal: Number.POSITIVE_INFINITY }),
    '\r\n\x1b[31m[process exited with signal unknown (code unknown)]\x1b[0m\r\n',
  )
})
