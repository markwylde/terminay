import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const sharedPath = new URL('../src/shared/SharedSettingsRouteBody.tsx', import.meta.url)
const settingsWindowPath = new URL('../src/components/SettingsWindow.tsx', import.meta.url)

test('settings route body chrome lives in a host-neutral shared component', async () => {
  const source = await readFile(sharedPath, 'utf8')

  assert.match(source, /export function SharedSettingsRouteBody/)
  assert.match(source, /data-shared-route-body="settings"/)
  assert.match(source, /settings-shell/)
  assert.match(source, /settings-sidebar/)
  assert.match(source, /settings-main/)

  for (const forbidden of [
    'window.',
    'document.',
    '@xterm/',
    'electron',
    'node:',
    'HttpByteTransport',
    'TerminayClient',
    'window.terminay',
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      `SharedSettingsRouteBody must not depend on host/transport primitive ${forbidden}`,
    )
  }
})

test('settings search has a durable accessible name independent of its placeholder', async () => {
  const source = await readFile(sharedPath, 'utf8')

  assert.match(source, /type="search"[\s\S]*aria-label=\{`Search \$\{title\} settings`\}/)
})

test('generated select controls expose their visible settings label', async () => {
  const source = await readFile(settingsWindowPath, 'utf8')

  assert.match(source, /<select[\s\S]{0,160}?aria-label=\{field\.label\}/u)
})

test('desktop settings route consumes the shared settings route body', async () => {
  const source = await readFile(settingsWindowPath, 'utf8')

  assert.match(source, /from '..\/shared\/SharedSettingsRouteBody'/)
  assert.match(source, /<SharedSettingsRouteBody[\s\S]*query=\{query\}/)
  assert.match(source, /categories=\{visibleCategories\.map/)
  assert.match(source, /preview=\{settingsPreview\}/)
  assert.match(source, /modal=\{pairingPinModal\}/)

  assert.equal(
    /<div className="settings-shell"/.test(source),
    false,
    'SettingsWindow must not retain the top-level settings route shell markup',
  )
})
