import assert from 'node:assert/strict'
import test from 'node:test'
import { GIT_STATUS_TOUCH_TARGET_PX, createGitStatusPanel } from './GitStatusPanel.mjs'

test('Git status panels share one accessible wide and narrow contract', () => {
  const wide = createGitStatusPanel({
    projectId: 'project:terminay', label: 'Terminay', branch: 'main', status: 'changes', layout: 'wide', detail: '3 changed files',
  })
  const narrow = createGitStatusPanel({
    projectId: 'project:terminay', label: 'Terminay', branch: 'main', status: 'changes', layout: 'narrow', detail: '3 changed files',
  })

  assert.equal(wide.role, 'region')
  assert.equal(wide.ariaLabel, 'Git status for Terminay')
  assert.deepEqual(wide.statusRegion, { role: 'status', ariaLive: 'polite', ariaAtomic: true, ariaBusy: false })
  assert.deepEqual(wide.openAction, {
    id: 'open-git', projectId: 'project:terminay', label: 'Open Git for Terminay', minTouchTargetPx: GIT_STATUS_TOUCH_TARGET_PX,
  })
  assert.equal(wide.retryAction, undefined)
  assert.deepEqual({ ...narrow, layout: 'wide' }, wide)
})

test('Git status panels distinguish loading, clean, conflicts, unavailable, and retryable failures', () => {
  const loading = createGitStatusPanel({ projectId: 'project:one', label: 'One', status: 'loading', layout: 'narrow' })
  const clean = createGitStatusPanel({ projectId: 'project:one', label: 'One', status: 'clean', layout: 'wide' })
  const conflict = createGitStatusPanel({ projectId: 'project:one', label: 'One', status: 'conflict', layout: 'wide' })
  const unavailable = createGitStatusPanel({ projectId: 'project:one', label: 'One', status: 'unavailable', layout: 'wide' })
  const failed = createGitStatusPanel({ projectId: 'project:one', label: 'One', status: 'failed', layout: 'wide' })

  assert.equal(loading.statusRegion.ariaBusy, true)
  assert.equal(clean.openAction, undefined)
  assert.equal(conflict.openAction.id, 'open-git')
  assert.equal(unavailable.retryAction, undefined)
  assert.deepEqual(failed.retryAction, {
    id: 'retry-git-status', projectId: 'project:one', label: 'Retry Git status', minTouchTargetPx: GIT_STATUS_TOUCH_TARGET_PX,
  })
})

test('Git status panels fail closed for unsafe identifiers, text, states, and layouts', () => {
  assert.throws(
    () => createGitStatusPanel({ projectId: 'bad id', label: 'One', status: 'clean', layout: 'wide' }),
    /safe project id/u,
  )
  assert.throws(
    () => createGitStatusPanel({ projectId: 'project:one', label: 'bad\nlabel', status: 'clean', layout: 'wide' }),
    /safe, non-empty text/u,
  )
  assert.throws(
    () => createGitStatusPanel({ projectId: 'project:one', label: 'One', status: 'unknown', layout: 'wide' }),
    /supported Git status/u,
  )
  assert.throws(
    () => createGitStatusPanel({ projectId: 'project:one', label: 'One', status: 'clean', layout: 'medium' }),
    /wide or narrow/u,
  )
})
