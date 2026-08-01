import assert from 'node:assert/strict'
import test from 'node:test'
import { QUICK_PUSH_REVIEW_TOUCH_TARGET_PX, createQuickPushReviewPanel } from './QuickPushReviewPanel.mjs'

const commits = [
  { hash: 'a1b2c3d', summary: 'Improve shared workspace', author: 'Mark' },
  { hash: 'd4e5f6a', summary: 'Add mobile layout' },
]

test('Quick Push review shares one accessible wide and narrow contract', () => {
  const wide = createQuickPushReviewPanel({ projectId: 'project:terminay', projectLabel: 'Terminay', branch: 'main', commits, status: 'ready', layout: 'wide' })
  const narrow = createQuickPushReviewPanel({ projectId: 'project:terminay', projectLabel: 'Terminay', branch: 'main', commits, status: 'ready', layout: 'narrow' })
  assert.equal(wide.role, 'region')
  assert.equal(wide.ariaLabel, 'Quick Push review for Terminay')
  assert.deepEqual(wide.statusRegion, { role: 'status', ariaLive: 'polite', ariaAtomic: true, ariaBusy: false })
  assert.deepEqual(wide.commits.items[0].copyAction, { id: 'copy-quick-push-commit-hash', projectId: 'project:terminay', commitHash: 'a1b2c3d', label: 'Copy commit a1b2c3d', minTouchTargetPx: QUICK_PUSH_REVIEW_TOUCH_TARGET_PX })
  assert.deepEqual(wide.pushAction, { id: 'confirm-quick-push', projectId: 'project:terminay', label: 'Push 2 commits', minTouchTargetPx: QUICK_PUSH_REVIEW_TOUCH_TARGET_PX })
  assert.deepEqual({ ...narrow, layout: 'wide' }, wide)
})

test('Quick Push review distinguishes loading, empty, unavailable, and retryable failure', () => {
  const loading = createQuickPushReviewPanel({ projectId: 'project:one', projectLabel: 'One', branch: 'main', status: 'loading', layout: 'wide' })
  const empty = createQuickPushReviewPanel({ projectId: 'project:one', projectLabel: 'One', branch: 'main', status: 'empty', layout: 'narrow' })
  const unavailable = createQuickPushReviewPanel({ projectId: 'project:one', projectLabel: 'One', branch: 'main', status: 'unavailable', layout: 'wide' })
  const failed = createQuickPushReviewPanel({ projectId: 'project:one', projectLabel: 'One', branch: 'main', status: 'failed', layout: 'wide' })
  assert.equal(loading.statusRegion.ariaBusy, true)
  assert.equal(empty.pushAction, undefined)
  assert.equal(unavailable.retryAction, undefined)
  assert.deepEqual(failed.retryAction, { id: 'retry-quick-push-review', projectId: 'project:one', label: 'Retry Quick Push review', minTouchTargetPx: QUICK_PUSH_REVIEW_TOUCH_TARGET_PX })
})

test('Quick Push review fails closed for unsafe or contradictory server data', () => {
  assert.throws(() => createQuickPushReviewPanel({ projectId: 'bad id', projectLabel: 'One', branch: 'main', status: 'empty', layout: 'wide' }), /safe Quick Push project id/u)
  assert.throws(() => createQuickPushReviewPanel({ projectId: 'project:one', projectLabel: 'One', branch: 'main', status: 'ready', layout: 'wide' }), /must include at least one commit/u)
  assert.throws(() => createQuickPushReviewPanel({ projectId: 'project:one', projectLabel: 'One', branch: 'main', status: 'empty', layout: 'wide', commits }), /cannot include commits/u)
  assert.throws(() => createQuickPushReviewPanel({ projectId: 'project:one', projectLabel: 'One', branch: 'main', status: 'ready', layout: 'wide', commits: [{ hash: 'wrong hash', summary: 'One' }] }), /commit hash/u)
  assert.throws(() => createQuickPushReviewPanel({ projectId: 'project:one', projectLabel: 'bad\nproject', branch: 'main', status: 'empty', layout: 'wide' }), /safe, non-empty text/u)
})
