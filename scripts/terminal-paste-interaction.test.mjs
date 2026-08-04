import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const outputDirectory = await mkdtemp(join(tmpdir(), 'terminay-terminal-paste-interaction-'))
const outputPath = join(outputDirectory, 'terminalPasteInteraction.mjs')

await build({
  bundle: true,
  entryPoints: ['src/components/terminalPasteInteraction.ts'],
  format: 'esm',
  outfile: outputPath,
  platform: 'node',
})

const { pasteTerminalClipboard } = await import(pathToFileURL(outputPath).href)

test.after(async () => {
  await rm(outputDirectory, { recursive: true, force: true })
})

test('terminal paste sends non-empty clipboard text through xterm and announces one input', async () => {
  const pasted = []
  let announcements = 0
  let focusCalls = 0

  const handled = await pasteTerminalClipboard(
    async () => 'printf hello',
    {
      announceInput: () => { announcements += 1 },
      paste: (text) => { pasted.push(text) },
      focus: () => { focusCalls += 1 },
    },
  )

  assert.equal(handled, true)
  assert.deepEqual(pasted, ['printf hello'])
  assert.equal(announcements, 1)
  assert.equal(focusCalls, 0)
})

test('terminal paste ignores empty or non-text clipboard values without announcing input', async () => {
  for (const value of ['', null, { text: 'not text' }]) {
    const pasted = []
    let announcements = 0
    const handled = await pasteTerminalClipboard(
      async () => value,
      {
        announceInput: () => { announcements += 1 },
        paste: (text) => { pasted.push(text) },
        focus: () => {},
      },
    )

    assert.equal(handled, false)
    assert.deepEqual(pasted, [])
    assert.equal(announcements, 0)
  }
})

test('terminal paste recovers from clipboard and xterm failures so the next paste can proceed', async () => {
  let focusCalls = 0
  let fail = true
  const pasted = []
  const options = {
    announceInput: () => {},
    paste: (text) => {
      if (fail) throw new Error('xterm unavailable')
      pasted.push(text)
    },
    focus: () => { focusCalls += 1 },
  }

  assert.equal(await pasteTerminalClipboard(async () => 'first', options), false)
  fail = false
  assert.equal(await pasteTerminalClipboard(async () => 'second', options), true)
  assert.deepEqual(pasted, ['second'])
  assert.equal(focusCalls, 1)
})
