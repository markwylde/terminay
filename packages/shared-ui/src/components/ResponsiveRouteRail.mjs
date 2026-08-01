/**
 * Host-neutral interaction model for a responsive workspace route rail.
 *
 * Hosts render the returned items as buttons or tabs. Keeping keyboard and
 * touch behaviour here prevents the desktop and browser shells from drifting
 * when the same route list collapses from a vertical rail to a horizontal,
 * scrollable control on narrow screens.
 */
export const MINIMUM_TOUCH_TARGET_PX = 44

function selectableIndexes(items) {
  return items.flatMap((item, index) => item.disabled ? [] : [index])
}

function requireRoute(items, route) {
  const index = items.findIndex(item => item.id === route)
  if (index === -1 || items[index].disabled) {
    throw new TypeError('The active route must identify an enabled route')
  }
  return index
}

/**
 * Produces accessible, responsive route-rail state without assuming React,
 * Electron, or a concrete transport. A host should set `activeRoute` after
 * calling `nextRoute` and preserve the resulting focus target.
 */
export function createResponsiveRouteRail(items, activeRoute) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new TypeError('Responsive route rails require at least one route')
  }

  const normalized = items.map(item => {
    if (!item || typeof item.id !== 'string' || item.id.length === 0 || typeof item.label !== 'string') {
      throw new TypeError('Each route requires a non-empty id and label')
    }
    return Object.freeze({
      id: item.id,
      label: item.label,
      disabled: item.disabled === true,
      minTouchTargetPx: MINIMUM_TOUCH_TARGET_PX,
    })
  })

  if (new Set(normalized.map(item => item.id)).size !== normalized.length) {
    throw new TypeError('Responsive route rail ids must be unique')
  }

  const selectable = selectableIndexes(normalized)
  if (selectable.length === 0) {
    throw new TypeError('Responsive route rails require one enabled route')
  }

  requireRoute(normalized, activeRoute)
  return Object.freeze({
    role: 'navigation',
    ariaLabel: 'Workspace routes',
    narrowLayout: Object.freeze({
      overflowX: 'auto',
      touchAction: 'pan-x',
      minTouchTargetPx: MINIMUM_TOUCH_TARGET_PX,
    }),
    items: Object.freeze(normalized),
    activeRoute,
  })
}

/**
 * Returns the route to focus/select for a keyboard intent. Disabled routes
 * are never returned; unknown keys preserve the current selection.
 */
export function nextResponsiveRoute(rail, key) {
  if (!rail || !Array.isArray(rail.items)) {
    throw new TypeError('A responsive route rail is required')
  }

  const selectable = selectableIndexes(rail.items)
  const currentIndex = requireRoute(rail.items, rail.activeRoute)
  const currentSelectableIndex = selectable.indexOf(currentIndex)

  switch (key) {
    case 'Home':
      return rail.items[selectable[0]].id
    case 'End':
      return rail.items[selectable.at(-1)].id
    case 'ArrowRight':
    case 'ArrowDown':
      return rail.items[selectable[(currentSelectableIndex + 1) % selectable.length]].id
    case 'ArrowLeft':
    case 'ArrowUp':
      return rail.items[selectable[(currentSelectableIndex - 1 + selectable.length) % selectable.length]].id
    default:
      return rail.activeRoute
  }
}
