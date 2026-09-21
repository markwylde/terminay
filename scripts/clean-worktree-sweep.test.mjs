import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cleanWorktreeSweepConfirmation,
  cleanWorktreeSweepOutcome,
  isBulkDeletableWorktree,
  isWorktreeShownClean,
} from '../src/workspace/cleanWorktreeSweep.ts'

function worktree(overrides = {}) {
  return {
    path: '/workspace/repo-feature',
    name: 'repo-feature',
    branch: 'feature',
    head: 'a'.repeat(40),
    aheadOfMainCount: 0,
    lineAdditions: 0,
    lineDeletions: 0,
    lastChangedAt: null,
    isDirtyBranch: false,
    isCurrent: false,
    isMain: false,
    isBare: false,
    isDetached: false,
    isLocked: false,
    isPrunable: false,
    entries: [],
    ...overrides,
  }
}

test('a worktree reads clean only without committed, working-tree, or line changes', () => {
  assert.equal(isWorktreeShownClean(worktree()), true)
  assert.equal(isWorktreeShownClean(worktree({ lineAdditions: null, lineDeletions: null })), true)
  assert.equal(isWorktreeShownClean(worktree({ isDirtyBranch: true })), false)
  assert.equal(isWorktreeShownClean(worktree({ entries: [{ path: '/workspace/repo-feature/a' }] })), false)
  assert.equal(isWorktreeShownClean(worktree({ lineAdditions: 1 })), false)
  assert.equal(isWorktreeShownClean(worktree({ lineDeletions: 1 })), false)
})

test('the bulk delete nominates clean linked worktrees and nothing protected or busy', () => {
  assert.equal(isBulkDeletableWorktree(worktree()), true)
  for (const protectedBy of [
    { isDirtyBranch: true },
    { entries: [{ path: '/workspace/repo-feature/a' }] },
    { lineAdditions: 3 },
    { isMain: true },
    { isBare: true },
    { isCurrent: true },
    { isLocked: true },
    { isPrunable: true },
    { head: null },
    { errorMessage: 'Worktree status failed.' },
  ]) {
    assert.equal(isBulkDeletableWorktree(worktree(protectedBy)), false, JSON.stringify(protectedBy))
  }
  assert.equal(isBulkDeletableWorktree(worktree(), new Set(['/workspace/repo-feature'])), false)
  assert.equal(isBulkDeletableWorktree(worktree(), new Set(['/workspace/other'])), true)
})

test('the confirmation counts and names every target, truncating a long list', () => {
  const three = cleanWorktreeSweepConfirmation(['one', 'two', 'three'])
  assert.match(three, /^Delete 3 clean worktrees\?/)
  for (const name of ['one', 'two', 'three']) assert.match(three, new RegExp(`^ {2}${name}$`, 'm'))
  assert.match(three, /Branches are kept\./)
  assert.match(cleanWorktreeSweepConfirmation(['only']), /^Delete 1 clean worktree\?/)
  const many = cleanWorktreeSweepConfirmation(Array.from({ length: 23 }, (_, index) => `wt-${index}`))
  assert.match(many, /^Delete 23 clean worktrees\?/)
  assert.match(many, /^ {2}wt-19$/m)
  assert.doesNotMatch(many, /wt-20/)
  assert.match(many, /…and 3 more/)
})

test('the outcome is silent on full success and names each skipped worktree with its reason', () => {
  assert.equal(cleanWorktreeSweepOutcome(4, []), null)
  const outcome = cleanWorktreeSweepOutcome(2, [{ name: 'late', reason: 'worktree is no longer clean' }])
  assert.match(outcome, /^Deleted 2 clean worktrees\. 1 was not deleted:/)
  assert.match(outcome, /late — worktree is no longer clean/)
})
