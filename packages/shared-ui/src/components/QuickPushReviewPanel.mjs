export const QUICK_PUSH_REVIEW_TOUCH_TARGET_PX = 44
export const MAX_QUICK_PUSH_COMMITS = 100

const STATUS_COPY = Object.freeze({
  loading: Object.freeze({ label: 'Loading Quick Push review', description: 'Loading commits for review…', busy: true, retryable: false }),
  ready: Object.freeze({ label: 'Quick Push review ready', description: 'Review the commits before pushing.', busy: false, retryable: false }),
  empty: Object.freeze({ label: 'Nothing to push', description: 'There are no commits waiting to be pushed.', busy: false, retryable: false }),
  unavailable: Object.freeze({ label: 'Quick Push unavailable', description: 'Quick Push is not available for this project.', busy: false, retryable: false }),
  failed: Object.freeze({ label: 'Quick Push review failed', description: 'Terminay could not load the Quick Push review. Try again.', busy: false, retryable: true }),
})

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const SAFE_HASH = /^[a-f0-9]{7,64}$/iu

function safeId(value, field) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new TypeError(`A safe Quick Push ${field} is required`)
  return value
}

function safeText(value, field, maximumLength) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`The Quick Push ${field} must be safe, non-empty text`)
  }
  return value
}

function createCommit(commit, projectId) {
  if (!commit || typeof commit !== 'object' || Array.isArray(commit)) throw new TypeError('Each Quick Push commit must be an object')
  if (typeof commit.hash !== 'string' || !SAFE_HASH.test(commit.hash)) throw new TypeError('A safe Quick Push commit hash is required')
  const summary = safeText(commit.summary, 'commit summary', 240)
  const author = commit.author === undefined ? undefined : safeText(commit.author, 'commit author', 160)
  return Object.freeze({
    hash: commit.hash,
    summary,
    author,
    role: 'listitem',
    copyAction: Object.freeze({ id: 'copy-quick-push-commit-hash', projectId, commitHash: commit.hash, label: `Copy commit ${commit.hash}`, minTouchTargetPx: QUICK_PUSH_REVIEW_TOUCH_TARGET_PX }),
  })
}

/** Host-neutral Quick Push review data and intents for responsive hosts. */
export function createQuickPushReviewPanel({ projectId, projectLabel, branch, commits = [], status, layout }) {
  const safeProjectId = safeId(projectId, 'project id')
  const safeProjectLabel = safeText(projectLabel, 'project label', 160)
  const safeBranch = safeText(branch, 'branch', 128)
  if (!Object.hasOwn(STATUS_COPY, status)) throw new TypeError('A supported Quick Push review status is required')
  if (layout !== 'wide' && layout !== 'narrow') throw new TypeError('The Quick Push review layout must be wide or narrow')
  if (!Array.isArray(commits) || commits.length > MAX_QUICK_PUSH_COMMITS) throw new TypeError(`Quick Push commits must be an array of at most ${MAX_QUICK_PUSH_COMMITS} items`)
  if (status === 'ready' && commits.length === 0) throw new TypeError('A ready Quick Push review must include at least one commit')
  if (status === 'empty' && commits.length !== 0) throw new TypeError('An empty Quick Push review cannot include commits')
  if ((status === 'loading' || status === 'unavailable' || status === 'failed') && commits.length !== 0) throw new TypeError('A non-ready Quick Push review cannot include commits')

  const items = commits.map(commit => createCommit(commit, safeProjectId))
  if (new Set(items.map(item => item.hash.toLowerCase())).size !== items.length) throw new TypeError('Quick Push commit hashes must be unique')
  const copy = STATUS_COPY[status]
  const pushAction = status === 'ready'
    ? Object.freeze({ id: 'confirm-quick-push', projectId: safeProjectId, label: `Push ${items.length} commits`, minTouchTargetPx: QUICK_PUSH_REVIEW_TOUCH_TARGET_PX })
    : undefined
  const retryAction = copy.retryable
    ? Object.freeze({ id: 'retry-quick-push-review', projectId: safeProjectId, label: 'Retry Quick Push review', minTouchTargetPx: QUICK_PUSH_REVIEW_TOUCH_TARGET_PX })
    : undefined

  return Object.freeze({
    role: 'region', ariaLabel: `Quick Push review for ${safeProjectLabel}`, layout,
    projectId: safeProjectId, projectLabel: safeProjectLabel, branch: safeBranch,
    status, statusLabel: copy.label, statusDescription: copy.description,
    statusRegion: Object.freeze({ role: 'status', ariaLive: 'polite', ariaAtomic: true, ariaBusy: copy.busy }),
    commits: Object.freeze({ role: 'list', ariaLabel: 'Commits to push', items: Object.freeze(items) }),
    pushAction, retryAction,
  })
}
