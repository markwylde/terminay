import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import test from 'node:test'

const outputDirectory = await mkdtemp(join(tmpdir(), 'terminay-terminal-switcher-interaction-'))
const outputPath = join(outputDirectory, 'terminalSwitcherInteraction.mjs')

await build({
  bundle: true,
  entryPoints: ['src/components/terminalSwitcherInteraction.ts'],
  format: 'esm',
  outfile: outputPath,
  platform: 'node',
})

const {
  getTerminalSwitcherDirection,
  terminalSwitcherLabels,
  terminalSwitcherModifier,
  terminalSwitcherReleaseKey,
} = await import(pathToFileURL(outputPath).href)

test.after(async () => {
  await rm(outputDirectory, { force: true, recursive: true })
})

function shortcut(overrides = {}) {
  return {
    altKey: true,
    ctrlKey: false,
    key: 'Tab',
    metaKey: false,
    repeat: false,
    shiftKey: false,
    ...overrides,
  }
}

test('terminal switcher claims Alt+Tab and reverses only with Shift', () => {
  assert.equal(getTerminalSwitcherDirection(shortcut()), 1)
  assert.equal(getTerminalSwitcherDirection(shortcut({ key: 'tab', shiftKey: true })), -1)
})

test('terminal switcher leaves repeated and extended-modifier chords alone', () => {
  assert.equal(getTerminalSwitcherDirection(shortcut({ repeat: true })), null)
  assert.equal(getTerminalSwitcherDirection(shortcut({ ctrlKey: true })), null)
  assert.equal(getTerminalSwitcherDirection(shortcut({ metaKey: true })), null)
  assert.equal(getTerminalSwitcherDirection(shortcut({ altKey: false })), null)
  assert.equal(getTerminalSwitcherDirection(shortcut({ key: 'Escape' })), null)
})

test('Desktop on Windows and Linux switches with Ctrl+Tab; macOS and browsers with Alt+Tab', () => {
  assert.equal(terminalSwitcherModifier({ isDesktop: true, platform: 'Win32' }), 'ctrl')
  assert.equal(terminalSwitcherModifier({ isDesktop: true, platform: 'Linux x86_64' }), 'ctrl')
  assert.equal(terminalSwitcherModifier({ isDesktop: true, platform: 'MacIntel' }), 'alt')
  assert.equal(terminalSwitcherModifier({ isDesktop: false, platform: 'Win32' }), 'alt')
  assert.equal(terminalSwitcherModifier({ isDesktop: false, platform: 'MacIntel' }), 'alt')
})

test('the Ctrl chord claims Ctrl+Tab and Ctrl+Shift+Tab, and nothing with Alt or Meta', () => {
  const ctrl = (overrides) => shortcut({ altKey: false, ctrlKey: true, ...overrides })
  assert.equal(getTerminalSwitcherDirection(ctrl(), 'ctrl'), 1)
  assert.equal(getTerminalSwitcherDirection(ctrl({ shiftKey: true }), 'ctrl'), -1)
  assert.equal(getTerminalSwitcherDirection(ctrl({ altKey: true }), 'ctrl'), null)
  assert.equal(getTerminalSwitcherDirection(ctrl({ metaKey: true }), 'ctrl'), null)
  assert.equal(getTerminalSwitcherDirection(ctrl({ repeat: true }), 'ctrl'), null)
  // Alt+Tab belongs to the operating system where Ctrl is the chord.
  assert.equal(getTerminalSwitcherDirection(shortcut(), 'ctrl'), null)
  // And Ctrl+Tab is a plain key where Alt is the chord.
  assert.equal(getTerminalSwitcherDirection(ctrl(), 'alt'), null)
})

test('the switch commits on the chord modifier and the heading names it', () => {
  assert.equal(terminalSwitcherReleaseKey('ctrl'), 'Control')
  assert.equal(terminalSwitcherReleaseKey('alt'), 'Alt')
  assert.deepEqual(terminalSwitcherLabels('ctrl'), { chord: 'Ctrl+Tab', hint: 'Release Ctrl to switch' })
  assert.deepEqual(terminalSwitcherLabels('alt'), { chord: 'Alt+Tab', hint: 'Release Alt to switch' })
})
