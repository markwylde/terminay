import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [runtime, source] = await Promise.all([
  readFile('src/rendererRuntime.tsx', 'utf8'),
  readFile('src/components/RecordingsWindow.tsx', 'utf8'),
])

test('production server workspace recordings route uses the canonical client', () => {
  assert.match(runtime, /new RecordingsClient\(\s*new TerminayClientFacade\(/u)
  assert.match(runtime, /<RecordingsWindow client=\{serverRecordingsClient\} \/>/u)
  assert.match(source, /<SharedRecordingsRouteBody/u)
  assert.doesNotMatch(runtime, /ServerRecordingsRoute|ServerWorkspaceSurface/u)
})
