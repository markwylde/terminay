import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const routes = [
  ['settings', 'src/shared/SharedSettingsRouteBody.tsx', 'src/components/SettingsWindow.tsx'],
  ['macros', 'src/shared/SharedMacroRouteBody.tsx', 'src/components/MacrosWindow.tsx'],
  ['recordings', 'src/shared/SharedRecordingsRouteBody.tsx', 'src/components/RecordingsWindow.tsx'],
  ['edit-tab', 'src/shared/SharedEditTabRouteBody.tsx', null],
]

test('all four auxiliary routes consume host-neutral shared bodies', async () => {
  for (const [route, sharedPath, desktopPath] of routes) {
    const [shared, desktop] = await Promise.all([readFile(sharedPath, 'utf8'), desktopPath === null ? Promise.resolve(null) : readFile(desktopPath, 'utf8')])
    assert.match(shared, new RegExp(`data-shared-route-body="${route}"`, 'u'))
    assert.doesNotMatch(shared, /window\.|electron|node:|TerminayClient|HttpByteTransport/u)
    const component = sharedPath.match(/\/(Shared[^/]+)\.tsx$/u)?.[1]
    assert.ok(component)
    if (desktop !== null) assert.match(desktop, new RegExp(`<${component}`, 'u'))
  }
})
