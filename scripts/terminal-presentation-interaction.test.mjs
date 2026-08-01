import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const outputDirectory = await mkdtemp(join(tmpdir(), 'terminay-terminal-presentation-interaction-'))
const outputPath = join(outputDirectory, 'terminalPresentationInteraction.mjs')

await build({
  bundle: true,
  entryPoints: ['src/components/terminalPresentationInteraction.ts'],
  format: 'esm',
  outfile: outputPath,
  platform: 'node',
})

const { buildTerminalPresentationOptions } = await import(pathToFileURL(outputPath).href)
const { defaultTerminalSettings, TAB_THEME_HUE_COLOR_VALUE } = await import(
  pathToFileURL(join(process.cwd(), 'src/terminalSettings.ts')).href,
).catch(async () => {
  const settingsPath = join(outputDirectory, 'terminalSettings.mjs')
  await build({
    bundle: true,
    entryPoints: ['src/terminalSettings.ts'],
    format: 'esm',
    outfile: settingsPath,
    platform: 'node',
  })
  return import(pathToFileURL(settingsPath).href)
})

test.after(async () => {
  await rm(outputDirectory, { recursive: true, force: true })
})

test('terminal presentation preserves base xterm settings while applying a safe host zoom', () => {
  const settings = {
    ...defaultTerminalSettings,
    fontFamily: 'Iosevka Term',
    fontSize: 13,
    lineHeight: 1.3,
  }

  const options = buildTerminalPresentationOptions(settings, undefined, -99)

  assert.equal(options.fontFamily, 'Iosevka Term')
  assert.equal(options.lineHeight, 1.3)
  assert.equal(options.fontSize, 6)
})

test('terminal presentation resolves tab-theme colours without mutating saved settings', () => {
  const settings = {
    ...defaultTerminalSettings,
    theme: {
      ...defaultTerminalSettings.theme,
      cursor: TAB_THEME_HUE_COLOR_VALUE,
      selectionBackground: 'tabThemeHue:40',
    },
  }

  const options = buildTerminalPresentationOptions(settings, '#336699', 0)

  assert.equal(options.theme?.cursor, '#336699')
  assert.notEqual(options.theme?.selectionBackground, TAB_THEME_HUE_COLOR_VALUE)
  assert.equal(settings.theme.cursor, TAB_THEME_HUE_COLOR_VALUE)
  assert.equal(settings.theme.selectionBackground, 'tabThemeHue:40')
})

test('malformed presentation zoom cannot replace the configured font size', () => {
  const options = buildTerminalPresentationOptions(defaultTerminalSettings, '#aa5500', Number.POSITIVE_INFINITY)

  assert.equal(options.fontSize, defaultTerminalSettings.fontSize)
  assert.equal(options.theme?.cursor, '#aa5500')
})

test('terminal presentation policy remains transport-neutral', async () => {
  const source = await readFile('src/components/terminalPresentationInteraction.ts', 'utf8')

  assert.doesNotMatch(source, /window\.terminay|TerminalPanelAttachment|\.write\(|\.resize\(/u)
})
