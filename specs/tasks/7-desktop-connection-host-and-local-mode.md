# Desktop connection host and Local mode

## Goal

Turn Terminay Desktop into a thin native connection host that supervises Local,
stores connection profiles securely, renders server-bundled UI in sandboxed
windows, and exposes only validated native host capabilities.

## Governing specifications

- [Connections and client hosts](../features/connections-and-client-hosts.md)
- [Settings, shortcuts, and desktop integration](../features/settings-shortcuts-and-desktop-integration.md)
- [Server runtime and application protocol](../features/server-runtime-and-protocol.md)

## Why this is active

The current Electron renderer receives a broad `window.terminay` preload API and
Electron main owns application services. Server-supplied remote UI cannot safely
inherit that ambient authority, and individual windows are not connection
profiles.

## Dependencies

- [Standalone and embedded server runtime](./6-standalone-and-embedded-server-runtime.md)

## Work slices

### Native host shell

- [ ] Build the minimal Desktop shell/header that owns current connection,
  window/view mapping, global connection menu, and native status.
- [ ] Render the selected server bundle in a sandboxed context/WebContentsView
  with context isolation and Node disabled.
- [x] Define a narrow versioned host bridge for window/view open/focus/close,
  menu commands, clipboard, approved file dialogs, external links, reveal, and
  update status.
- [x] Validate source, target, payload, current connection, and user gesture for
  every bridge action.
- [x] Block arbitrary navigation, new windows, permission requests, downloads,
  and protocol handlers unless explicitly allowed.

### Local startup

- [x] Start the embedded server before the default workspace and create the
  immutable built-in **Local** profile from its stable identity.
- [x] Bind the first native window to Local and show Local in the header instead
  of **Remote**.
- [x] Handle starting, ready, migrating, failed, crashed, restarting, and stopped
  server states without showing a false connected workspace.
- [x] Ensure Local works without internet, hosted signaling, or WebRTC.

### Connection profile store

- [x] Define profile metadata separately from device/reconnect credentials.
- [ ] Store credentials using OS-backed secure storage when available and
  provide explicit degraded behaviour when unavailable.
- [x] Record server fingerprint/identity and detect unexpected identity changes
  at a remembered origin.
- [x] Persist local native window geometry and `(connection, workspaceView)`
  mapping without treating it as server workspace state.
- [x] Implement add/import, rename, archive/forget, and diagnostics APIs for the
  shared menu.

### Native windows and logical views

- [x] Bind each native window to exactly one server connection.
- [x] Focus an existing suitable window or open a new one when selecting a
  profile; make current-window rebinding explicit.
- [ ] Map server workspace views to native windows without making
  `BrowserWindow.id` canonical.
- [ ] Preserve current project popout/adoption UX through server view commands.
- [ ] Ensure closing a window only detaches that client/view unless the user
  explicitly deletes the logical view or closes terminals.

### Electron reduction

- [ ] Replace renderer feature calls to the broad preload API with
  `TerminayClient` or the narrow native bridge.
- [ ] Move/remove application service IPC handlers once their server protocol
  equivalents are active.
- [ ] Keep updater, menus, app lifecycle, OS integration, local credential
  storage, and server supervision in Electron.
- [x] Add an import-boundary test preventing application services from drifting
  back into the Desktop host.

## Acceptance checks

- Desktop launches offline into a sandboxed Local workspace supplied by the
  embedded server.
- Reloading/closing the workspace view leaves Local PTYs alive.
- A test server bundle cannot access Node, arbitrary Electron IPC, another
  profile's credentials, or an unrelated native window.
- Two Local workspace views can use separate native windows without duplicated
  PTYs.
- Native menu/clipboard/dialog actions work only through documented validated
  capabilities.

## Definition of done

Electron is a native host and supervisor rather than the application server.
Local is an ordinary built-in connection from the shared UI's perspective, and
server-provided code has no ambient machine privilege.
