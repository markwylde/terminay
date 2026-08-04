export const MAX_SHARED_ROUTE_PANELS = 16
const MAX_SHARED_ROUTE_PANEL_DEPTH = 8
const MAX_SHARED_ROUTE_PANEL_KEYS = 128
const MAX_SHARED_ROUTE_PANEL_ARRAY_ITEMS = 256

function route(label, panels) {
  return Object.freeze({
    label,
    panels: Object.freeze(panels),
    panelSet: new Set(panels),
  })
}

/* The panel sequence is a UI contract, not a host-specific implementation
 * detail. Canonicalizing it here means a feature fix has one shared visual and
 * assistive-technology order in both hosts, even when a host receives its
 * panels from asynchronous server snapshots. */
const ROUTE_COPY = Object.freeze({
  workspace: route('Workspace', ['workspace-tabs', 'workspace-views', 'dockview-navigation', 'activity-indicator', 'activity-notifications', 'terminal-session', 'file-viewer', 'folder-browser', 'agent-status', 'ai-tab-metadata', 'command-surface', 'workspace-empty']),
  connections: route('Connections', ['connection-form', 'connection-switcher', 'connection-error']),
  settings: route('Settings', ['settings', 'mcp-server-control', 'dictation-capture']),
  recordings: route('Recordings', ['recordings-library', 'recording-detail']),
  macros: route('Macros', ['macro-library', 'macro-editor']),
  file: route('Files', ['file-viewer', 'folder-browser']),
  git: route('Git', ['git-status', 'quick-push-review']),
})

/* Panel factories normally return frozen models, but route composition is a
 * public shared-UI boundary and must not rely on every caller doing so. Take a
 * bounded, data-only snapshot so a host cannot mutate an accepted panel after
 * composition (or smuggle a host callback/getter into a renderer-neutral
 * model). */
function snapshotPanelModel(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Shared route panel models must contain finite data only')
    return value
  }
  if (typeof value !== 'object') throw new TypeError('Shared route panel models must contain data only')
  if (depth >= MAX_SHARED_ROUTE_PANEL_DEPTH || seen.has(value)) {
    throw new TypeError('Shared route panel models must be bounded acyclic data')
  }
  seen.add(value)

  if (Array.isArray(value)) {
    if (value.length > MAX_SHARED_ROUTE_PANEL_ARRAY_ITEMS) throw new TypeError('Shared route panel arrays are too large')
    return Object.freeze(value.map(item => snapshotPanelModel(item, depth + 1, seen)))
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError('Shared route panel models must use plain data objects')
  }
  const keys = Object.keys(value)
  if (keys.length > MAX_SHARED_ROUTE_PANEL_KEYS || Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError('Shared route panel objects are too large or unsupported')
  }
  const copy = {}
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('Shared route panel models cannot contain accessors')
    }
    copy[key] = snapshotPanelModel(descriptor.value, depth + 1, seen)
  }
  return Object.freeze(copy)
}

function requirePanelEntry(entry, routeName, layout, seen) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError('Each shared route panel entry must be an object')
  const routeCopy = ROUTE_COPY[routeName]
  if (typeof entry.id !== 'string' || !routeCopy.panelSet.has(entry.id)) {
    throw new TypeError(`Panel ${String(entry.id)} is not valid for the ${routeName} route`)
  }
  if (seen.has(entry.id)) throw new TypeError('Shared route panel ids must be unique')
  if (!entry.panel || typeof entry.panel !== 'object' || Array.isArray(entry.panel)) {
    throw new TypeError('Each shared route panel must be a semantic panel model')
  }
  const allowsDialog = routeName === 'settings' && entry.id === 'dictation-capture'
  // Connection failures are intentionally assertive alerts. They belong only
  // to the Connections route, where both hosts render the same recovery
  // contract without turning an unrelated route region into an alert.
  const allowsAlert = routeName === 'connections' && entry.id === 'connection-error'
  // The project/view selector is intentionally navigation rather than a nested
  // region: it is the one shared model that owns listbox/tablist semantics.
  // The enclosing route remains the labelled region, so this preserves one
  // landmark per route while letting both hosts use the same navigator model.
  const allowsNavigation = routeName === 'workspace' && entry.id === 'workspace-views'
  // Workspace state is deliberately a status while loading/empty and an
  // assertive alert for unavailable or failed server state. Keeping that
  // semantic distinction intact here means the complete shared Workspace
  // route can compose the real state panel instead of substituting a generic
  // host-specific region.
  const allowsWorkspaceState = routeName === 'workspace' && entry.id === 'workspace-empty'
  const hasAllowedRole = entry.panel.role === 'region'
    || (allowsDialog && entry.panel.role === 'dialog')
    || (allowsAlert && entry.panel.role === 'alert')
    || (allowsNavigation && entry.panel.role === 'navigation')
    || (allowsWorkspaceState && (entry.panel.role === 'status' || entry.panel.role === 'alert'))
  if (!hasAllowedRole) {
    throw new TypeError('Each shared route panel must be a region model, except the settings dictation dialog, connections alert, workspace navigation, or workspace state status/alert')
  }
  if (typeof entry.panel.ariaLabel !== 'string' || entry.panel.ariaLabel.trim().length === 0 || entry.panel.ariaLabel.length > 160 || /[\u0000-\u001f\u007f]/u.test(entry.panel.ariaLabel)) {
    throw new TypeError('Each shared route panel needs a safe aria label')
  }
  if (entry.panel.layout !== layout) {
    throw new TypeError('Each shared route panel must use the route layout')
  }
  seen.add(entry.id)
  return Object.freeze({ id: entry.id, panel: snapshotPanelModel(entry.panel) })
}

/**
 * Composes the already renderer-neutral feature panels into one registered
 * workspace route. It deliberately accepts render models only: fetching,
 * persistence, host navigation, and transport dispatch stay outside this
 * shared UI boundary.
 */
export function createSharedWorkspaceRoutePanel({ route, layout, panels }) {
  if (!Object.hasOwn(ROUTE_COPY, route)) throw new TypeError('A registered shared workspace route is required')
  if (layout !== 'wide' && layout !== 'narrow') throw new TypeError('The shared workspace route layout must be wide or narrow')
  if (!Array.isArray(panels) || panels.length === 0 || panels.length > MAX_SHARED_ROUTE_PANELS) {
    throw new TypeError(`Shared workspace routes require one to ${MAX_SHARED_ROUTE_PANELS} panels`)
  }

  const seen = new Set()
  const requested = panels.map(panel => requirePanelEntry(panel, route, layout, seen))
  const copy = ROUTE_COPY[route]
  const components = Object.freeze(copy.panels
    .map(id => requested.find(panel => panel.id === id))
    .filter(panel => panel !== undefined))
  return Object.freeze({
    role: 'region',
    ariaLabel: `${copy.label} route`,
    route,
    layout,
    components,
  })
}

/**
 * Builds a route only when the caller has supplied every registered feature
 * panel. Hosts use this at the route boundary once a server snapshot is ready;
 * accepting a partial model remains useful for loading/error sub-surfaces, but
 * must not be mistaken for a complete shared workspace route.
 */
export function createCompleteSharedWorkspaceRoutePanel(options) {
  const model = createSharedWorkspaceRoutePanel(options)
  const expected = ROUTE_COPY[model.route].panels
  if (model.components.length !== expected.length) {
    throw new TypeError(`The complete ${model.route} route requires every registered feature panel`)
  }
  return model
}
