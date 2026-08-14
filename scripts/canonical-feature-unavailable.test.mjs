import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const directory = await mkdtemp(join(tmpdir(), 'terminay-canonical-unavailable-'))
const output = join(directory, 'unavailable.mjs')
await build({
  bundle: true,
  stdin: {
    contents: `
      export { MacroSettingsUnavailableError } from './src/hooks/useMacroSettings.ts'
      export { RecordingCapabilityUnavailableError, requireRecordingClient } from './src/workspace/useTerminalRecordingController.ts'
    `,
    loader: 'ts',
    resolveDir: process.cwd(),
  },
  format: 'esm',
  logLevel: 'silent',
  outfile: output,
  platform: 'node',
})
const {
  MacroSettingsUnavailableError,
  RecordingCapabilityUnavailableError,
  requireRecordingClient,
} = await import(pathToFileURL(output).href)

test.after(() => rm(directory, { force: true, recursive: true }))

test('missing selected-server recording authority is typed unavailable', () => {
  assert.throws(() => requireRecordingClient(undefined), (error) => {
    assert.ok(error instanceof RecordingCapabilityUnavailableError)
    assert.equal(error.code, 'unavailable')
    assert.match(error.message, /selected server recording capability/u)
    return true
  })
})

test('selected-server recording authority passes through unchanged', () => {
  const client = Object.freeze({ reveal() {}, start() {}, stop() {} })
  assert.equal(requireRecordingClient(client), client)
})

test('macro capability absence uses the same typed unavailable contract', () => {
  const error = new MacroSettingsUnavailableError()
  assert.equal(error.code, 'unavailable')
  assert.match(error.message, /selected server macro settings client/u)
})
