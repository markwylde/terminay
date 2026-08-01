import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MINIMUM_TOUCH_TARGET_PX,
  createResponsiveRouteRail,
  nextResponsiveRoute,
} from './ResponsiveRouteRail.mjs'

const routes = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'connections', label: 'Connections', disabled: true },
  { id: 'settings', label: 'Settings' },
  { id: 'recordings', label: 'Recordings' },
]

test('responsive route rail exposes horizontal narrow-layout and touch contracts', () => {
  const rail = createResponsiveRouteRail(routes, 'workspace')

  assert.equal(rail.role, 'navigation')
  assert.equal(rail.ariaLabel, 'Workspace routes')
  assert.deepEqual(rail.narrowLayout, {
    overflowX: 'auto',
    touchAction: 'pan-x',
    minTouchTargetPx: 44,
  })
  assert.equal(MINIMUM_TOUCH_TARGET_PX, 44)
  assert.ok(rail.items.every(item => item.minTouchTargetPx >= 44))
})

test('responsive route rail keyboard navigation wraps and skips disabled routes', () => {
  const rail = createResponsiveRouteRail(routes, 'workspace')

  assert.equal(nextResponsiveRoute(rail, 'ArrowRight'), 'settings')
  assert.equal(nextResponsiveRoute(rail, 'ArrowLeft'), 'recordings')
  assert.equal(nextResponsiveRoute(rail, 'ArrowDown'), 'settings')
  assert.equal(nextResponsiveRoute(rail, 'Home'), 'workspace')
  assert.equal(nextResponsiveRoute(rail, 'End'), 'recordings')
  assert.equal(nextResponsiveRoute(rail, 'Enter'), 'workspace')
})

test('responsive route rail fails closed for invalid or disabled active routes', () => {
  assert.throws(() => createResponsiveRouteRail([], 'workspace'), /at least one route/u)
  assert.throws(() => createResponsiveRouteRail(routes, 'connections'), /enabled route/u)
  assert.throws(
    () => createResponsiveRouteRail([{ id: 'workspace', label: 'Workspace' }, { id: 'workspace', label: 'Duplicate' }], 'workspace'),
    /unique/u,
  )
})
