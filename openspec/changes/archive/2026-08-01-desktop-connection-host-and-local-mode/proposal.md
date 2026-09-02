## Why

The Electron renderer received a broad `window.terminay` preload API and Electron main owned
application services. Server-supplied remote UI cannot safely inherit that ambient authority,
and individual native windows were not connection profiles.

## What Changes

- **BREAKING** Remove the broad `window.terminay` preload API and its application-service IPC
  handlers, replacing them with narrow versioned host bridges that validate sender, envelope,
  version, current connection, and bounded payloads.
- Turn Terminay Desktop into a thin native connection host: a minimal shell/header owning the
  current connection, window/view mapping, global connection menu, and native status.
- Render the selected server bundle in a sandboxed context with Node disabled, context
  isolation, web security on, and webviews disabled; deny window, navigation, download, and
  permission escapes.
- Bind server-bundle loading to the authenticated current connection, prove same-origin final
  URLs, and reject stale or oversized responses before rendering.
- Start the embedded server before the default workspace and create the immutable built-in
  **Local** profile from its stable identity; bind the first window to Local.
- Add a connection profile store separating profile metadata from device and reconnect
  credentials, with OS-backed secure storage and explicit degraded behaviour.
- Bind each native window to exactly one server connection and map server workspace views to
  native windows without making `BrowserWindow.id` canonical.
- Route project popout, adoption, merge, and logical-view closure through authenticated server
  commands (`view.create`, `project.move`, `view.close`) rather than host-owned state.
- Add an import-boundary test preventing application services from drifting back into the host.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `connections-and-client-hosts`: Desktop becomes a protocol-blind connection host with Local
  as a built-in profile, per-window connection binding, and a versioned source-bound bridge.
- `settings-shortcuts-and-desktop-integration`: native menus, updater, clipboard, reveal, and
  OS integration stay in Electron behind validated capability bridges.

## Impact

`apps/terminay-desktop` main, preload, and renderer; `electron/serverUiHost.ts`; the workspace
renderer's host-capability boundary; every retired `app:*`, `fs:*`, `shell:*`, `clipboard:*`,
`terminal:*`, `terminal-recording:*`, `agent-status:*`, and `mcp-install:*` IPC route.
