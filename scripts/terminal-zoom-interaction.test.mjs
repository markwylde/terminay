import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const outputDirectory = await mkdtemp(join(tmpdir(), 'terminay-terminal-zoom-interaction-'))
const outputPath = join(outputDirectory, 'terminalZoomInteraction.mjs')

await build({
  bundle: true,
  entryPoints: ['src/components/terminalZoomInteraction.ts'],
  format: 'esm',
  outfile: outputPath,
  platform: 'node',
})

const { resolveTerminalZoomedFontSize } = await import(pathToFileURL(outputPath).href)

test.after(async () => {
  await rm(outputDirectory, { recursive: true, force: true })
})

test('terminal zoom applies finite positive and negative presentation deltas', () => {
  assert.equal(resolveTerminalZoomedFontSize(13, 2), 15)
  assert.equal(resolveTerminalZoomedFontSize(13, -2), 11)
  assert.equal(resolveTerminalZoomedFontSize(13.5, 0.5), 14)
})

test('terminal zoom keeps a readable minimum font size', () => {
  assert.equal(resolveTerminalZoomedFontSize(13, -99), 6)
  assert.equal(resolveTerminalZoomedFontSize(2, 0), 6)
})

test('terminal zoom ignores malformed host values without corrupting xterm options', () => {
  assert.equal(resolveTerminalZoomedFontSize(undefined, undefined), 13)
  assert.equal(resolveTerminalZoomedFontSize(Number.NaN, 2), 15)
  assert.equal(resolveTerminalZoomedFontSize(13, Number.POSITIVE_INFINITY), 13)
})
