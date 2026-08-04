export const WORKSPACE_NAVIGATOR_TOUCH_TARGET_PX = 44

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

function safeText(value, field, maximumLength = 128) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`The workspace ${field} must be safe, non-empty text`)
  }
  return value
}

function safeIdentifier(value, field) {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value)) {
    throw new TypeError(`A safe workspace ${field} is required`)
  }
  return value
}

/**
 * Produces the shared, server-model-driven project and logical-view navigator.
 * Hosts render the returned semantics in a sidebar or a narrow horizontal
 * selector; activation is an intent, never a host or transport side effect.
 */
export function createWorkspaceViewNavigatorPanel({ projects, views, activeProjectId, activeViewId, layout }) {
  if (layout !== 'wide' && layout !== 'narrow') {
    throw new TypeError('The workspace navigator layout must be wide or narrow')
  }
  if (!Array.isArray(projects) || projects.length === 0 || projects.length > 100) {
    throw new TypeError('Workspace navigator projects must contain between one and 100 entries')
  }
  if (!Array.isArray(views) || views.length === 0 || views.length > 100) {
    throw new TypeError('Workspace navigator views must contain between one and 100 entries')
  }
  safeIdentifier(activeProjectId, 'active project id')
  safeIdentifier(activeViewId, 'active view id')

  const projectIds = new Set()
  const safeProjects = projects.map(project => {
    if (!project || typeof project !== 'object') throw new TypeError('A workspace project is required')
    const id = safeIdentifier(project.id, 'project id')
    if (projectIds.has(id)) throw new TypeError('Workspace project ids must be unique')
    projectIds.add(id)
    return Object.freeze({
      id,
      label: safeText(project.label, 'project label'),
      selected: id === activeProjectId,
      role: 'option',
      ariaSelected: id === activeProjectId,
      action: Object.freeze({ id: 'select-project', projectId: id, label: `Select project ${project.label}`, minTouchTargetPx: WORKSPACE_NAVIGATOR_TOUCH_TARGET_PX }),
    })
  })
  if (!projectIds.has(activeProjectId)) throw new TypeError('The active project must be present')

  const viewIds = new Set()
  const safeViews = views.map(view => {
    if (!view || typeof view !== 'object') throw new TypeError('A workspace view is required')
    const id = safeIdentifier(view.id, 'view id')
    if (viewIds.has(id)) throw new TypeError('Workspace view ids must be unique')
    viewIds.add(id)
    return Object.freeze({
      id,
      label: safeText(view.label, 'view label'),
      selected: id === activeViewId,
      role: 'tab',
      ariaSelected: id === activeViewId,
      tabIndex: id === activeViewId ? 0 : -1,
      action: Object.freeze({ id: 'select-view', viewId: id, label: `Select view ${view.label}`, minTouchTargetPx: WORKSPACE_NAVIGATOR_TOUCH_TARGET_PX }),
    })
  })
  if (!viewIds.has(activeViewId)) throw new TypeError('The active view must be present')

  return Object.freeze({
    role: 'navigation',
    ariaLabel: 'Workspace navigation',
    layout,
    projectSelector: Object.freeze({
      role: 'listbox',
      ariaLabel: 'Projects',
      ariaOrientation: layout === 'narrow' ? 'horizontal' : 'vertical',
      overflowX: layout === 'narrow' ? 'auto' : 'visible',
      items: Object.freeze(safeProjects),
    }),
    viewSelector: Object.freeze({
      role: 'tablist',
      ariaLabel: 'Workspace views',
      ariaOrientation: layout === 'narrow' ? 'horizontal' : 'vertical',
      overflowX: layout === 'narrow' ? 'auto' : 'visible',
      items: Object.freeze(safeViews),
    }),
  })
}
