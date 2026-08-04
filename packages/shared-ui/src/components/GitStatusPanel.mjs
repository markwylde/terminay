export const GIT_STATUS_TOUCH_TARGET_PX = 44

const STATUS_COPY = Object.freeze({
  loading: Object.freeze({ label: 'Loading Git status', description: 'Loading repository status…', busy: true, retryable: false }),
  clean: Object.freeze({ label: 'Working tree clean', description: 'No uncommitted changes.', busy: false, retryable: false }),
  changes: Object.freeze({ label: 'Changes to review', description: 'This repository has uncommitted changes.', busy: false, retryable: false }),
  conflict: Object.freeze({ label: 'Conflicts need resolution', description: 'Resolve merge conflicts before continuing.', busy: false, retryable: false }),
  unavailable: Object.freeze({ label: 'Git unavailable', description: 'Git status is not available for this project.', busy: false, retryable: false }),
  failed: Object.freeze({ label: 'Git status failed', description: 'Terminay could not load repository status.', busy: false, retryable: true }),
})

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

function requireSafeText(value, field, maximumLength) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`The Git ${field} must be safe, non-empty text`)
  }
  return value
}

/**
 * Creates the host-neutral state contract for a repository's Git status. The
 * host supplies an authoritative summary and handles the resulting navigation
 * or retry intents; this model deliberately contains no Git, transport, or
 * host API dependency.
 */
export function createGitStatusPanel({ projectId, label, status, layout, branch, detail }) {
  if (typeof projectId !== 'string' || !SAFE_ID.test(projectId)) {
    throw new TypeError('A safe project id is required')
  }
  if (!Object.hasOwn(STATUS_COPY, status)) {
    throw new TypeError('A supported Git status is required')
  }
  if (layout !== 'wide' && layout !== 'narrow') {
    throw new TypeError('The Git status layout must be wide or narrow')
  }

  const safeLabel = requireSafeText(label, 'label', 128)
  const safeBranch = branch === undefined ? undefined : requireSafeText(branch, 'branch', 128)
  const safeDetail = detail === undefined ? undefined : requireSafeText(detail, 'detail', 240)
  const copy = STATUS_COPY[status]
  const retryAction = copy.retryable
    ? Object.freeze({ id: 'retry-git-status', projectId, label: 'Retry Git status', minTouchTargetPx: GIT_STATUS_TOUCH_TARGET_PX })
    : undefined
  const openAction = status === 'changes' || status === 'conflict'
    ? Object.freeze({ id: 'open-git', projectId, label: `Open Git for ${safeLabel}`, minTouchTargetPx: GIT_STATUS_TOUCH_TARGET_PX })
    : undefined

  return Object.freeze({
    role: 'region',
    ariaLabel: `Git status for ${safeLabel}`,
    layout,
    projectId,
    label: safeLabel,
    branch: safeBranch,
    detail: safeDetail,
    status,
    statusLabel: copy.label,
    statusDescription: copy.description,
    statusRegion: Object.freeze({
      role: 'status',
      ariaLive: 'polite',
      ariaAtomic: true,
      ariaBusy: copy.busy,
    }),
    openAction,
    retryAction,
  })
}
