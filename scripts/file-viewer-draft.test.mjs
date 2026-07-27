import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { build } from 'esbuild'

globalThis.window = globalThis

const require = createRequire(import.meta.url)
const bundleDirectory = await mkdtemp(path.join(os.tmpdir(), 'terminay-file-draft-test-'))
const outputPath = path.join(bundleDirectory, 'draft-buffer.cjs')

await build({
  bundle: true,
  entryPoints: ['src/services/fileViewer/draftBuffer.ts'],
  format: 'cjs',
  logLevel: 'silent',
  outfile: outputPath,
  platform: 'node',
})

const { createFileDraftBuffer } = require(outputPath)

test.after(async () => {
  await rm(bundleDirectory, { force: true, recursive: true })
})

test('preserves the original revision while converting text drafts to byte edits', () => {
  const draft = createFileDraftBuffer({ text: 'hello\n' })

  draft.setText('Hello\n')
  draft.setByte(1, 'A'.charCodeAt(0))

  assert.equal(draft.getText(), 'HAllo\n')
  assert.equal(draft.isDirty(), true)

  draft.setText('hello\n')
  assert.equal(draft.isDirty(), false)
})

test('preserves byte edits while converting through text mode', () => {
  const original = Buffer.from('switch me\n', 'utf8')
  const draft = createFileDraftBuffer({ base64: original.toString('base64') })

  draft.setByte(0, 'S'.charCodeAt(0))
  assert.equal(draft.getText(), 'Switch me\n')
  assert.equal(draft.isDirty(), true)

  draft.setText(draft.getText())
  draft.setByte(7, 'M'.charCodeAt(0))
  assert.equal(draft.getText(), 'Switch Me\n')
  assert.equal(draft.getPayload().kind, 'binary')
  assert.equal(draft.isDirty(), true)
})
