import assert from 'node:assert/strict'
import test from 'node:test'
import { FILE_VIEWER_TOUCH_TARGET_PX, createFileViewerPanel } from './FileViewerPanel.mjs'

test('file viewer states use one accessible wide and narrow shared contract', () => {
  const wide = createFileViewerPanel({
    fileId: 'file:readme',
    label: 'README.md',
    status: 'ready',
    layout: 'wide',
    mimeType: 'text/markdown',
    readOnly: true,
  })
  const narrow = createFileViewerPanel({
    fileId: 'file:readme',
    label: 'README.md',
    status: 'ready',
    layout: 'narrow',
    mimeType: 'text/markdown',
    readOnly: true,
  })

  assert.equal(wide.role, 'region')
  assert.equal(wide.ariaLabel, 'File README.md')
  assert.equal(wide.statusLabel, 'File ready')
  assert.deepEqual(wide.statusRegion, { role: 'status', ariaLive: 'polite', ariaAtomic: true, ariaBusy: false })
  assert.deepEqual(wide.contentRegion, { role: 'document', ariaLive: 'off', ariaLabel: 'File contents for README.md' })
  assert.equal(wide.retryAction, undefined)
  assert.deepEqual({ ...narrow, layout: 'wide' }, wide)
})

test('file viewer states distinguish loading, retryable, inaccessible, and deleted files', () => {
  const loading = createFileViewerPanel({ fileId: 'file:one', label: 'one.ts', status: 'loading', layout: 'narrow' })
  const failed = createFileViewerPanel({ fileId: 'file:one', label: 'one.ts', status: 'failed', layout: 'wide' })
  const forbidden = createFileViewerPanel({ fileId: 'file:one', label: 'one.ts', status: 'forbidden', layout: 'wide' })
  const deleted = createFileViewerPanel({ fileId: 'file:one', label: 'one.ts', status: 'deleted', layout: 'wide' })

  assert.equal(loading.statusRegion.ariaBusy, true)
  assert.deepEqual(failed.retryAction, {
    id: 'retry-file', fileId: 'file:one', label: 'Retry file', minTouchTargetPx: FILE_VIEWER_TOUCH_TARGET_PX,
  })
  assert.equal(forbidden.retryAction, undefined)
  assert.equal(deleted.statusLabel, 'File was deleted')
})

test('file viewer panels fail closed for unsafe identifiers, text, states, and layouts', () => {
  assert.throws(
    () => createFileViewerPanel({ fileId: 'bad id', label: 'one.ts', status: 'ready', layout: 'wide' }),
    /safe file id/u,
  )
  assert.throws(
    () => createFileViewerPanel({ fileId: 'file:one', label: 'bad\nname', status: 'ready', layout: 'wide' }),
    /safe, non-empty text/u,
  )
  assert.throws(
    () => createFileViewerPanel({ fileId: 'file:one', label: 'one.ts', status: 'unknown', layout: 'wide' }),
    /supported file status/u,
  )
  assert.throws(
    () => createFileViewerPanel({ fileId: 'file:one', label: 'one.ts', status: 'ready', layout: 'medium' }),
    /wide or narrow/u,
  )
})
