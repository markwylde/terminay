import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [runtime, source] = await Promise.all([
  readFile('src/rendererRuntime.tsx', 'utf8'),
  readFile('src/components/MacrosWindow.tsx', 'utf8'),
])

test('production server workspace macros route uses the canonical client', () => {
  assert.match(runtime, /new MacroClient\(\s*new TerminayClientFacade\(/u)
  assert.match(runtime, /<MacrosWindow[\s\S]*macroSettingsClient=\{serverMacroSettingsClient\}/u)
  assert.match(source, /<SharedMacroRouteBody/u)
  assert.doesNotMatch(runtime, /ServerMacrosRoute|ServerWorkspaceSurface/u)
})
