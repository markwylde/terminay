export const WORKSPACE_EMPTY_STATE_TOUCH_TARGET_PX = 44

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

const COPY = Object.freeze({
  loading: Object.freeze({ title: 'Loading workspace', description: 'Terminay is loading this server workspace.', action: null }),
  'no-projects': Object.freeze({ title: 'No projects yet', description: 'This server workspace does not contain a project yet.', action: 'create-project' }),
  'no-panels': Object.freeze({ title: 'Nothing is open', description: 'Choose a workspace view or open a panel to continue.', action: 'open-view' }),
  unavailable: Object.freeze({ title: 'Workspace is unavailable', description: 'The server did not provide workspace state.', action: 'retry' }),
  failed: Object.freeze({ title: 'Could not load workspace', description: 'Terminay could not load the current workspace. Try again.', action: 'retry' }),
})

function safeId(value, field) {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value)) {
    throw new TypeError(`A safe ${field} is required`)
  }
  return value
}

function safeLayout(layout) {
  if (layout !== 'wide' && layout !== 'narrow') {
    throw new TypeError('The workspace empty-state layout must be wide or narrow')
  }
  return layout
}

/**
 * Produces a host- and transport-neutral workspace empty/error surface. It
 * deliberately carries only server-scoped identifiers and declarative intents;
 * the host decides whether those intents open a route, drawer, or inline view.
 */
export function createWorkspaceEmptyStatePanel({ serverId, status, layout, projectId = null }) {
  const safeServerId = safeId(serverId, 'server id')
  safeLayout(layout)
  if (!Object.hasOwn(COPY, status)) {
    throw new TypeError('A supported workspace empty-state status is required')
  }
  if (projectId !== null && projectId !== undefined) safeId(projectId, 'project id')
  if (status === 'no-panels' && typeof projectId !== 'string') {
    throw new TypeError('A project id is required when no workspace panels are open')
  }
  if (status === 'no-projects' && projectId !== null && projectId !== undefined) {
    throw new TypeError('An empty project workspace cannot include a project id')
  }

  const copy = COPY[status]
  const action = copy.action === null ? null : Object.freeze({
    id: copy.action,
    serverId: safeServerId,
    ...(projectId ? { projectId } : {}),
    label: copy.action === 'create-project' ? 'Create project' : copy.action === 'open-view' ? 'Open workspace view' : 'Retry workspace',
    minTouchTargetPx: WORKSPACE_EMPTY_STATE_TOUCH_TARGET_PX,
  })

  return Object.freeze({
    role: status === 'failed' || status === 'unavailable' ? 'alert' : 'status',
    ariaLive: status === 'failed' || status === 'unavailable' ? 'assertive' : 'polite',
    ariaAtomic: true,
    ariaLabel: 'Workspace state',
    serverId: safeServerId,
    projectId: projectId ?? null,
    status,
    layout,
    title: copy.title,
    description: copy.description,
    action,
  })
}
