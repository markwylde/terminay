import {
  MINIMUM_TOUCH_TARGET_PX,
  createResponsiveRouteRail,
  nextResponsiveRoute,
} from './ResponsiveRouteRail.mjs'

/**
 * Produces renderer-neutral properties for the compact workspace navigation.
 *
 * The desktop shell can render the result in its sidebar, while a browser or
 * narrow Electron window can render the same routes as a horizontally
 * scrollable tablist. No UI framework or host APIs are required here.
 */
export function createResponsiveRoutePane(items, activeRoute, {
  narrow = false,
  activation = 'automatic',
  idPrefix = 'terminay-route',
} = {}) {
  if (typeof narrow !== 'boolean') {
    throw new TypeError('The narrow-pane state must be a boolean')
  }
  if (activation !== 'automatic' && activation !== 'manual') {
    throw new TypeError('The route-pane activation mode must be automatic or manual')
  }
  if (typeof idPrefix !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/u.test(idPrefix)) {
    throw new TypeError('The route-pane id prefix must be a non-empty HTML id prefix')
  }

  const rail = createResponsiveRouteRail(items, activeRoute)
  const layout = narrow
    ? Object.freeze({
        orientation: 'horizontal',
        overflowX: rail.narrowLayout.overflowX,
        touchAction: rail.narrowLayout.touchAction,
      })
    : Object.freeze({
        orientation: 'vertical',
        overflowX: 'visible',
        touchAction: 'auto',
      })

  const paneItems = Object.freeze(rail.items.map(item => {
    const routeIdentifier = encodeURIComponent(item.id)
    const tabId = `${idPrefix}-tab-${routeIdentifier}`
    const panelId = `${idPrefix}-panel-${routeIdentifier}`
    return Object.freeze({
      ...item,
      role: 'tab',
      tabId,
      ariaControls: panelId,
      ariaDisabled: item.disabled,
      ariaSelected: item.id === rail.activeRoute,
      tabIndex: item.id === rail.activeRoute ? 0 : -1,
      minTouchTargetPx: MINIMUM_TOUCH_TARGET_PX,
    })
  }))
  const panels = Object.freeze(rail.items.map(item => {
    const routeIdentifier = encodeURIComponent(item.id)
    return Object.freeze({
      routeId: item.id,
      panelId: `${idPrefix}-panel-${routeIdentifier}`,
      role: 'tabpanel',
      ariaLabelledby: `${idPrefix}-tab-${routeIdentifier}`,
      hidden: item.id !== rail.activeRoute,
    })
  }))

  return Object.freeze({
    role: 'tablist',
    ariaLabel: rail.ariaLabel,
    ariaOrientation: layout.orientation,
    activation,
    layout,
    activeRoute: rail.activeRoute,
    items: paneItems,
    panels,
  })
}

/**
 * Resolves a route-key interaction into the next selected route and its focus
 * target. Hosts can use this result for both keyboard navigation and a
 * programmatic focus after a responsive layout transition.
 */
export function resolveResponsiveRoutePaneKey(pane, key, focusedRoute = pane?.activeRoute) {
  if (!pane || !Array.isArray(pane.items) || typeof pane.activeRoute !== 'string') {
    throw new TypeError('A responsive route pane is required')
  }
  const focusedItem = pane.items.find(item => item.id === focusedRoute)
  if (!focusedItem || focusedItem.disabled) {
    throw new TypeError('The focused route must identify an enabled route')
  }

  const navigationKeys = new Set([
    'Home',
    'End',
    'ArrowRight',
    'ArrowDown',
    'ArrowLeft',
    'ArrowUp',
  ])
  const isNavigationKey = navigationKeys.has(key)
  const isActivationKey = key === 'Enter' || key === ' '
  const nextRoute = isNavigationKey
    ? nextResponsiveRoute({ items: pane.items, activeRoute: focusedRoute }, key)
    : focusedRoute
  const shouldActivate = (pane.activation !== 'manual' && isNavigationKey) || isActivationKey
  const activeRoute = shouldActivate ? nextRoute : pane.activeRoute
  return Object.freeze({
    activeRoute,
    focusRoute: nextRoute,
    changed: activeRoute !== pane.activeRoute,
  })
}
