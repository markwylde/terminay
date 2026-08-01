import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const outputDirectory = await mkdtemp(join(tmpdir(), 'terminay-terminal-clipboard-interaction-'))
const outputPath = join(outputDirectory, 'terminalClipboardInteraction.mjs')

await build({
  bundle: true,
  entryPoints: ['src/components/terminalClipboardInteraction.ts'],
  format: 'esm',
  outfile: outputPath,
  platform: 'node',
})

const { copyTerminalSelection } = await import(pathToFileURL(outputPath).href)

test.after(async () => {
  await rm(outputDirectory, { recursive: true, force: true })
})

test('terminal selection copy ignores an empty selection without calling the clipboard', async () => {
  let calls = 0
  const copied = await copyTerminalSelection('', async () => {
    calls += 1
  })

  assert.equal(copied, false)
  assert.equal(calls, 0)
})

test('terminal selection copy handles a clipboard denial and permits an immediate retry', async () => {
  const writes = []
  let denied = true
  const writeClipboardText = async (text) => {
    writes.push(text)
    if (denied) {
      throw new Error('clipboard permission denied')
    }
  }

  assert.equal(await copyTerminalSelection('first selection', writeClipboardText), false)
  denied = false
  assert.equal(await copyTerminalSelection('second selection', writeClipboardText), true)
  assert.deepEqual(writes, ['first selection', 'second selection'])
})
