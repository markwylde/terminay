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

const transitionOutputPath = path.join(bundleDirectory, 'shared-draft-transition.cjs')
await build({
  bundle: true,
  entryPoints: ['src/components/file-viewer/modes/sharedDraftTransition.ts'],
  format: 'cjs',
  logLevel: 'silent',
  outfile: transitionOutputPath,
  platform: 'node',
})
const { materializePerformantDraft } = require(transitionOutputPath)

const watchDispositionOutputPath = path.join(bundleDirectory, 'file-watch-disposition.cjs')
await build({
  bundle: true,
  entryPoints: ['src/components/file-viewer/fileWatchDisposition.ts'],
  format: 'cjs',
  logLevel: 'silent',
  outfile: watchDispositionOutputPath,
  platform: 'node',
})
const { resolveFileWatchDisposition } = require(watchDispositionOutputPath)

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

test('treats an unacknowledged watch event while dirty as an external conflict', () => {
  const disposition = resolveFileWatchDisposition({
    // Documentation autosave does not currently acknowledge the revision its
    // session save writes before the filesystem watcher reports it.
    acknowledgedRevision: null,
    event: {
      exists: true,
      mtimeMs: 1_777_000_000_000,
      path: '/project/AGENTS.md',
      size: 28,
      type: 'updated',
    },
    // On macOS the watcher can win the race with the save response that clears
    // this flag. This is the ordering reported by the application screenshot.
    isDirty: true,
  })

  assert.equal(disposition, 'external-conflict')
})

test('a delayed watch event from the first documentation save must not conflict with the second edit', () => {
  // Save 1 has returned "Synced" and retained the revision it wrote. The user
  // begins edit 2 before macOS delivers save 1's filesystem event.
  const disposition = resolveFileWatchDisposition({
    acknowledgedRevision: {
      mtimeMs: 1_777_000_000_001,
      path: '/project/AGENTS.md',
      size: 943,
    },
    event: {
      exists: true,
      mtimeMs: 1_777_000_000_001,
      path: '/project/AGENTS.md',
      size: 943,
      type: 'updated',
    },
    isDirty: true,
  })

  assert.equal(disposition, 'acknowledged-write')
})

test('materializes a Performant sparse draft into Monaco without losing edits or dirty state', () => {
  const result = materializePerformantDraft('alpha\n雪 beta\nomega\n', [{
    dataBase64: Buffer.from('changed 雪', 'utf8').toString('base64'),
    end: Buffer.byteLength('alpha\n雪 beta', 'utf8'),
    start: Buffer.byteLength('alpha\n', 'utf8'),
  }])

  assert.equal(result.text, 'alpha\nchanged 雪\nomega\n')
  assert.equal(result.dirty, true)
  assert.deepEqual(materializePerformantDraft('unchanged', []).text, 'unchanged')
  assert.equal(materializePerformantDraft('unchanged', []).dirty, false)
})
