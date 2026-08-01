import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const outputDirectory = await mkdtemp(join(tmpdir(), 'terminay-terminal-link-interaction-'))
const outputPath = join(outputDirectory, 'terminalLinkInteraction.mjs')

await build({
  bundle: true,
  entryPoints: ['src/components/terminalLinkInteraction.ts'],
  format: 'esm',
  outfile: outputPath,
  platform: 'node',
})

const { createTerminalLinkInteraction } = await import(pathToFileURL(outputPath).href)

test.after(async () => {
  await rm(outputDirectory, { recursive: true, force: true })
})

function modifierEvent() {
  return {
    ctrlKey: true,
    metaKey: false,
    prevented: false,
    preventDefault() {
      this.prevented = true
    },
  }
}

test('terminal links preserve pointer affordance and deduplicate both xterm link handlers', async () => {
  const pointerTarget = { style: { cursor: '' } }
  const opened = []
  let now = 100
  const interaction = createTerminalLinkInteraction({
    isMac: false,
    pointerTarget,
    now: () => now,
    openExternal: async (uri) => {
      opened.push(uri)
    },
  })
  const event = modifierEvent()

  interaction.hover()
  assert.equal(pointerTarget.style.cursor, 'pointer')
  interaction.leave()
  assert.equal(pointerTarget.style.cursor, '')

  interaction.activate(event, 'https://terminay.com')
  interaction.activate(event, 'https://terminay.com')
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(event.prevented, true)
  assert.deepEqual(opened, ['https://terminay.com'])
  now += 501
  interaction.activate(event, 'https://terminay.com')
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(opened, ['https://terminay.com', 'https://terminay.com'])
})

test('terminal links require the platform modifier and a rejected handoff permits immediate retry', async () => {
  const pointerTarget = { style: { cursor: '' } }
  const opened = []
  let fail = true
  const interaction = createTerminalLinkInteraction({
    isMac: false,
    pointerTarget,
    openExternal: async (uri) => {
      opened.push(uri)
      if (fail) throw new Error('native browser unavailable')
    },
  })
  const ordinaryEvent = { ctrlKey: false, metaKey: false, preventDefault() { throw new Error('must not prevent') } }
  interaction.activate(ordinaryEvent, 'https://terminay.com/retry')
  assert.deepEqual(opened, [])

  interaction.activate(modifierEvent(), 'https://terminay.com/retry')
  await new Promise((resolve) => setImmediate(resolve))
  fail = false
  interaction.activate(modifierEvent(), 'https://terminay.com/retry')
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(opened, ['https://terminay.com/retry', 'https://terminay.com/retry'])
})
