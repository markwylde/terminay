import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const sharedPath = new URL('../src/shared/SharedEditTabRouteBody.tsx', import.meta.url)

test('edit tab form body is host-neutral shared route UI', async () => {
  const source = await readFile(sharedPath, 'utf8')
  assert.match(source, /export function SharedEditTabRouteBody/)
  assert.match(source, /data-shared-route-body="edit-tab"/)
  assert.match(source, /Edit Project Tab/)
  assert.match(source, /Edit Terminal Tab/)
  assert.match(source, /Inherit project colour/)
  assert.match(source, /Enable activity indicators/)
  assert.match(source, /aria-label=\{state\.kind === 'project' \? 'Project theme hue' : 'Tab theme hue'\}/)
  assert.match(source, /aria-valuetext=\{`\$\{hueValue\} degrees`\}/)
  assert.match(source, /onSubmit: \(result: SharedEditTabResult\) => Promise<void>/)
  assert.match(source, /onCancel: \(\) => void/)
  for (const forbidden of ['window.', 'document.', 'electron', 'node:', '@xterm/', 'TerminayClient', 'window.terminay']) {
    assert.equal(source.includes(forbidden), false, `shared edit body must not import host primitive ${forbidden}`)
  }
})
