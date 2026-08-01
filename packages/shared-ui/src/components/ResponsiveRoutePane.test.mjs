import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createResponsiveRoutePane,
  resolveResponsiveRoutePaneKey,
} from './ResponsiveRoutePane.mjs'

const routes = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'connections', label: 'Connections', disabled: true },
  { id: 'settings', label: 'Settings' },
]

test('narrow route panes provide a horizontal, accessible tab model', () => {
  const pane = createResponsiveRoutePane(routes, 'workspace', { narrow: true })

  assert.equal(pane.role, 'tablist')
  assert.equal(pane.ariaLabel, 'Workspace routes')
  assert.equal(pane.ariaOrientation, 'horizontal')
  assert.deepEqual(pane.layout, {
    orientation: 'horizontal',
    overflowX: 'auto',
    touchAction: 'pan-x',
  })
  assert.deepEqual(pane.items.map(item => [item.id, item.role, item.ariaDisabled, item.ariaSelected, item.tabIndex]), [
    ['workspace', 'tab', false, true, 0],
    ['connections', 'tab', true, false, -1],
    ['settings', 'tab', false, false, -1],
  ])
  assert.ok(pane.items.every(item => item.minTouchTargetPx >= 44))
  assert.deepEqual(pane.items.map(item => [item.id, item.tabId, item.ariaControls]), [
    ['workspace', 'terminay-route-tab-workspace', 'terminay-route-panel-workspace'],
    ['connections', 'terminay-route-tab-connections', 'terminay-route-panel-connections'],
    ['settings', 'terminay-route-tab-settings', 'terminay-route-panel-settings'],
  ])
  assert.deepEqual(pane.panels, [
    {
      routeId: 'workspace',
      panelId: 'terminay-route-panel-workspace',
      role: 'tabpanel',
      ariaLabelledby: 'terminay-route-tab-workspace',
      hidden: false,
    },
    {
      routeId: 'connections',
      panelId: 'terminay-route-panel-connections',
      role: 'tabpanel',
      ariaLabelledby: 'terminay-route-tab-connections',
      hidden: true,
    },
    {
      routeId: 'settings',
      panelId: 'terminay-route-panel-settings',
      role: 'tabpanel',
      ariaLabelledby: 'terminay-route-tab-settings',
      hidden: true,
    },
  ])
})

test('route panes expose disabled tabs to assistive technology without making them focusable', () => {
  const pane = createResponsiveRoutePane(routes, 'workspace')
  const disabled = pane.items.find(item => item.id === 'connections')

  assert.deepEqual(disabled, {
    id: 'connections',
    label: 'Connections',
    disabled: true,
    minTouchTargetPx: 44,
    role: 'tab',
    tabId: 'terminay-route-tab-connections',
    ariaControls: 'terminay-route-panel-connections',
    ariaDisabled: true,
    ariaSelected: false,
    tabIndex: -1,
  })
  assert.equal(resolveResponsiveRoutePaneKey(pane, 'ArrowRight').focusRoute, 'settings')
  assert.throws(
    () => resolveResponsiveRoutePaneKey(pane, 'Enter', 'connections'),
    /enabled route/u,
  )
})

test('route panes use a stable custom ID prefix and expose exactly one active panel', () => {
  const pane = createResponsiveRoutePane(routes, 'settings', { idPrefix: 'workspace-shell' })

  assert.equal(pane.items.find(item => item.id === 'settings').tabId, 'workspace-shell-tab-settings')
  assert.equal(pane.panels.find(panel => panel.routeId === 'settings').panelId, 'workspace-shell-panel-settings')
  assert.deepEqual(pane.panels.filter(panel => !panel.hidden).map(panel => panel.routeId), ['settings'])
  assert.throws(
    () => createResponsiveRoutePane(routes, 'workspace', { idPrefix: 'invalid prefix' }),
    /HTML id prefix/u,
  )
})

test('manual route panes preserve selection while arrows move focus, then activate with Enter or Space', () => {
  const pane = createResponsiveRoutePane(routes, 'workspace', {
    narrow: true,
    activation: 'manual',
  })

  const focused = resolveResponsiveRoutePaneKey(pane, 'ArrowRight')
  assert.deepEqual(focused, {
    activeRoute: 'workspace',
    focusRoute: 'settings',
    changed: false,
  })
  assert.deepEqual(resolveResponsiveRoutePaneKey(pane, 'Enter', focused.focusRoute), {
    activeRoute: 'settings',
    focusRoute: 'settings',
    changed: true,
  })
  assert.deepEqual(resolveResponsiveRoutePaneKey(pane, ' ', focused.focusRoute), {
    activeRoute: 'settings',
    focusRoute: 'settings',
    changed: true,
  })
})

test('route pane keeps one roving focus target and skips disabled routes', () => {
  const pane = createResponsiveRoutePane(routes, 'workspace', { narrow: true })

  assert.deepEqual(resolveResponsiveRoutePaneKey(pane, 'ArrowRight'), {
    activeRoute: 'settings',
    focusRoute: 'settings',
    changed: true,
  })
  assert.deepEqual(resolveResponsiveRoutePaneKey(pane, 'Enter'), {
    activeRoute: 'workspace',
    focusRoute: 'workspace',
    changed: false,
  })
})

test('route pane ignores unrelated keys and never changes selection from a stale focus target', () => {
  const automatic = createResponsiveRoutePane(routes, 'workspace')

  assert.deepEqual(resolveResponsiveRoutePaneKey(automatic, 'x', 'settings'), {
    activeRoute: 'workspace',
    focusRoute: 'settings',
    changed: false,
  })
  assert.deepEqual(resolveResponsiveRoutePaneKey(automatic, 'Enter', 'settings'), {
    activeRoute: 'settings',
    focusRoute: 'settings',
    changed: true,
  })
})

test('wide route panes retain vertical layout and reject invalid state', () => {
  const pane = createResponsiveRoutePane(routes, 'settings')
  assert.deepEqual(pane.layout, {
    orientation: 'vertical',
    overflowX: 'visible',
    touchAction: 'auto',
  })
  assert.throws(() => createResponsiveRoutePane(routes, 'workspace', { narrow: 'yes' }), /boolean/u)
  assert.throws(() => createResponsiveRoutePane(routes, 'workspace', { activation: 'delayed' }), /activation mode/u)
  assert.throws(() => resolveResponsiveRoutePaneKey(null, 'ArrowRight'), /required/u)
  assert.throws(() => resolveResponsiveRoutePaneKey(pane, 'ArrowRight', 'connections'), /enabled route/u)
})
