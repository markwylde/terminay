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

- [x] Build the minimal Desktop shell/header that owns current connection,
  window/view mapping, global connection menu, and native status. The
  host-owned `createDesktopShellHeaderModel` projection is immutable and
  contains only sanitized profile metadata, opaque window/view ids, menu
  capabilities, and bounded native lifecycle status; it does not duplicate
  renderer workspace state. Focused coverage lives in
  `apps/terminay-desktop/test/shell-header.test.mjs`.
- [x] Render the selected server bundle in a sandboxed context/WebContentsView
  with context isolation and Node disabled. `electron/serverUiHost.ts` creates
  the isolated server UI host with Node disabled, sandboxing, web security, and
  webviews disabled, then denies window, navigation, download, and permission
  escapes; `e2e/server-ui-sandbox.spec.ts` and
  `scripts/task20-desktop-security-audit.test.mjs` cover the boundary.
- [x] Bind server-bundle loading to the authenticated current connection, prove
  same-origin final URLs, and reject stale or oversized responses before
  rendering.
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
- [x] Store credentials using OS-backed secure storage when available and
  provide explicit degraded behaviour when unavailable.
- [x] Record server fingerprint/identity and detect unexpected identity changes
  at a remembered origin.
- [x] Persist local native window geometry and `(connection, workspaceView)`
  mapping without treating it as server workspace state.
- [x] Implement add/import, rename, archive/forget, and diagnostics APIs for the
  shared menu.

### Native windows and logical views

- [x] Bind each native window to exactly one server connection.
  - Evidence: `scripts/task7-remote-connection-e2e.spec.ts` launches a real
    standalone server, pastes its pairing URL into the Desktop connection menu,
    proves the modal returns without an IPC/MessagePort deadlock, and requires
    the same native window to project `Remote · task7-remote-authority` rather
    than retaining Local authority.
- [x] Focus an existing suitable window or open a new one when selecting a
  profile; make current-window rebinding explicit.
- [x] Map server workspace views to native windows without making
  `BrowserWindow.id` canonical.
- [x] Preserve current project popout/adoption UX through server view commands.
  - Evidence: `DesktopConnectionHost.popoutProjectWindow` now creates a
    server-owned logical workspace view through `view.create`, moves the
    project through authenticated `project.move`, and only stores the native
    window/view presentation in the host-local registry. Focused coverage in
    `apps/terminay-desktop/test/workspace-adoption.test.mjs` proves project
    popout preserves panel/session identity, opens exactly one native binding,
    and rolls back both the native binding and empty created view when the move
    is rejected. Existing adoption coverage continues to prove accepted and
    rejected `project.move` behaviour.
- [x] Route explicit logical-view closure through the authenticated `view.close`
  command and detach only matching host view bindings after server acceptance;
  rejected commands preserve the native presentation.
- [x] Ensure closing a window only detaches that client/view unless the user
  explicitly deletes the logical view or closes terminals.

### Electron reduction

- [x] Replace renderer feature calls to the broad preload API with
  `TerminayClient` or the narrow native bridge. The package-wide renderer
  import boundary in `apps/terminay-desktop/test/renderer-preload-boundary.test.mjs`
  rejects Electron/IPC, Desktop main/preload imports, and broad
  `window.terminay` access.
  - [x] Move the current-server connection picker off the broad preload API.
    The Desktop renderer now receives only the versioned
    `terminayConnectionHost.open(url)` capability for this action;
    Electron main validates an exact `{ version: 1, url }` request from the
    trusted top-level frame before starting the connection. Focused coverage in
    `scripts/connection-menu-renderer.test.mjs` proves the current renderer
    does not call `window.terminay.openRemoteConnection`, and verifies the
    narrow preload and main-process validation boundary.
  - [x] Remove the retired broad `app:open-remote-connection` IPC handler and
    preload method after the current renderer moved to the versioned
    `terminayConnectionHost.open` bridge. The current bundle is shipped with
    its matching preload, so no legacy renderer must retain that ambient
    connection capability. `scripts/connection-menu-renderer.test.mjs` proves
    neither the broad preload method nor handler remains.
  - Evidence added: the production renderer shared-route boundary now derives
    shared responsive route capabilities from the narrow `terminayHost`
    preload bridge instead of hardcoding Desktop-native capabilities
    (`src/main.tsx`, `src/shared/ResponsiveWorkspaceEntry.tsx`,
    `src/vite-env.d.ts`). `scripts/shared-responsive-entry.test.mjs` proves the
    shared boundary consumes host capabilities and does not fabricate
    `nativeWindows`.
  - [x] Move connected FilePanel metadata and read-only content reads through
    the authenticated `FileViewerClient`. The adapter canonicalizes Desktop
    absolute paths to project-relative server paths and rejects outside-project
    paths before transport; save/watch/Git remain explicit compatibility
    boundaries until their server operations are composed. Evidence:
    `src/services/fileViewer/serverFileGateway.ts`, `FilePanel.tsx`, and
    `scripts/file-viewer-shared-client.test.mjs`.
  - [x] Remove the renderer's remaining profile/window compatibility import.
    The renderer-owned `profileWindowCommands` facade has no Electron,
    preload-implementation, or main-process dependency and exposes only an
    `openCurrentProfileWindow` operation bound to the host-provided connection
    id. Focused coverage in
    `apps/terminay-desktop/test/profile-window-commands.test.mjs` proves it
    cannot select another profile or dispatch unsnapshotted input.
- [x] Move/remove application service IPC handlers once their server protocol
  equivalents are active.
  - [x] Remove the obsolete renderer MessagePort/IPC compatibility client now
    that Desktop production paths use the shared direct `TerminayClient`
    connection. The package no longer exports or ships framed IPC transport or
    server-scoped IPC client code; `compatibility-lifecycle.test.mjs` proves
    renderer reload/window detachment against a transport-neutral client, and
    `ipc-compatibility-removal.test.mjs` proves the retired bridge is absent.
  - [x] Project only the versioned `terminayHost` API into a main-frame server
    bundle; the preload now copies exactly `version`, `getContext`, and
    `requestAction` instead of exposing its implementation object. This blocks
    future preload helpers from becoming ambient renderer authority. Focused
    coverage in `apps/terminay-desktop/test/host-bridge.test.mjs` proves the
    exact exposed shape, delegated calls, and subframe denial.
  - [x] Remove the legacy Electron `agent-status:*` application IPC handlers,
    preload methods, and snapshot event. Desktop now consumes and acknowledges
    agent state exclusively through the authenticated server `AgentStatusClient`.
    Renderer scope merging retains a host-created terminal during an unrelated
    workspace delta without widening server authorization. Evidence:
    `apps/terminay-desktop/test/ipc-compatibility-removal.test.mjs`,
    `packages/client-core/test/agent-status.test.mjs`, and the real Electron
    `e2e/agent-status-sidebar.spec.ts` lifecycle flows.
  - [x] Remove renderer project-root registration IPC. The server authority now
    validates and registers each workspace project's root before its first
    server-owned terminal becomes visible; the FolderPanel uses only the
    authenticated `FileViewerClient`. The renderer no longer receives a
    `registerServerProjectRoot` preload capability or a
    `server:register-project-root` channel. Focused coverage in
    `apps/terminay-desktop/test/ipc-compatibility-removal.test.mjs` and
    `scripts/folder-tasks-server-client.test.mjs` prevents this ambient
    application-service bridge from returning.
  - [x] Remove the legacy production `terminal:create` IPC handler and preload
    capability. Renderer terminal creation is server-owned through the
    authenticated terminal client; packaged PTY integrity tests use a separate
    `TERMINAY_TEST`-only harness capability. Focused coverage in
    `apps/terminay-desktop/test/ipc-compatibility-removal.test.mjs` proves the
    production preload, main handler, and renderer cannot restore the ambient
    terminal-creation bridge.
  - [x] Move native update-status reads off the broad application preload API.
    The workspace now receives only the versioned
    `terminayUpdateHost.getStatus(force)` capability; Electron validates the
    trusted sender and exact `{ version: 1, force }` envelope before checking
    its native update cache. `scripts/update-host-bridge.test.mjs` prevents
    the legacy `app:get-update-status` route, preload method, and production
    renderer call from returning.
  - [x] Remove the unused renderer `app:quit` IPC handler and preload method.
    Application shutdown remains an Electron lifecycle responsibility; no
    current renderer surface invokes it. The production preload, public type,
    and main-process handler are absent, with
    `apps/terminay-desktop/test/ipc-compatibility-removal.test.mjs` guarding
    against restoring ambient renderer shutdown authority.
  - [x] Move terminal presentation metadata publication off the broad
    application preload API. Terminal panels now use only the versioned
    `terminayTerminalPresentationHost.updateMetadata(sessionId, metadata)`
    capability; Electron validates the trusted sender, exact envelope,
    bounded session id, and bounded metadata fields before updating its native
    presentation/recording compatibility state. The retired
    `terminal:update-remote-metadata` route and
    `window.terminay.updateTerminalRemoteMetadata` method are absent.
    `scripts/terminal-presentation-host-bridge.test.mjs` covers both the
    narrow migration and absence boundary.
  - [x] Move local MCP installation off the broad application preload API.
    The MCP modal now receives only the versioned
    `terminayMcpInstallHost.{getStatus,install,uninstall}` capability; Electron
    validates the trusted sender, an exact versioned envelope, and the bounded
    Claude Code/Codex agent id before changing local agent configuration. The
    retired `mcp-install:*` routes and broad preload methods are absent.
    `scripts/mcp-install-host-bridge.test.mjs` guards the narrow migration and
    `scripts/trusted-ipc-sender.test.mjs` guards sender provenance.
  - [x] Move Desktop home-path bootstrap off the broad application preload API.
    The workspace now receives only the versioned read-only
    `terminayFileExplorerHost.getHomePath()` capability; Electron validates a
    trusted top-level sender and an exact `{ version: 1 }` request before
    returning the native home path. The legacy `fs:get-home-path` channel and
    broad preload/type method are absent. `scripts/file-explorer-host-bridge.test.mjs`
    covers the narrow migration and absence boundary.
  - [x] Move native project-edit window opening off the broad application
    preload API. The workspace now receives only the versioned
    `terminayProjectEditHost.open(draft)` capability; Electron validates the
    trusted sender, exact `{ version: 1, draft }` envelope, and bounded
    project-draft fields before retaining native window authority. The retired
    `app:open-project-edit` route and `window.terminay.openProjectEditWindow`
    method are absent. `scripts/project-edit-host-bridge.test.mjs` covers the
    narrow migration and absence boundary.
  - [x] Move terminal inactivity waiting off the broad application preload API.
    The renderer now receives only the versioned
    `terminayTerminalLifecycleHost.waitForInactivity(sessionId, durationMs)`
    capability; Electron validates the trusted sender, exact request envelope,
    attached terminal session, and a bounded duration before waiting. The
    retired `terminal:wait-for-inactivity` route and broad preload/type method
    are absent. `scripts/terminal-lifecycle-host-bridge.test.mjs` covers the
    narrow migration and absence boundary.
  - [x] Move final-project window closing off the broad application preload
    API. The renderer now receives only the versioned
    `terminayWindowLifecycleHost.closeCurrent()` capability; Electron validates
    a trusted sender and exact `{ version: 1 }` envelope before closing the
    sender's native window. The retired `app:close-this-window` route and
    `window.terminay.closeThisWindow` method are absent.
    `scripts/window-lifecycle-host-bridge.test.mjs` guards the narrow
    migration and absence boundary.
  - [x] Move project-tab bar geometry publication off the broad application
    preload API. The renderer now receives only the versioned
    `terminayProjectTabHost.publishBarRect(rect)` capability; Electron
    validates the trusted sender, exact `{ version: 1, rect }` envelope, and
    finite bounded rectangle before storing geometry for only the sender's
    native window. The retired `app:register-tabbar-rect` route and
    `window.terminay.registerProjectTabBarRect` method are absent.
    `scripts/project-tab-host-bridge.test.mjs` guards the migration and
    absence boundary.
  - [x] Move project-tab drag lifecycle commands off the broad application
    preload API. The renderer now receives only the versioned
    `terminayProjectTabHost.startDrag(preview)` and `.endDrag()` operations;
    Electron validates the trusted sender, exact versioned envelopes, and
    bounded preview fields before tracking the current native window's drag.
    The retired `app:project-drag-start` and `app:project-drag-end` routes and
    broad preload methods are absent. `scripts/project-tab-host-bridge.test.mjs`
    guards the migration and absence boundary.
  - [x] Remove the unused broad Git-panel status compatibility IPC. No
    production renderer called `getGitPanelStatus`, so the preload method,
    `fs:get-git-panel-status` handler, and public type were deleted rather
    than preserving a dead application-service route.
    `scripts/git-panel-status-ipc-removal.test.mjs` prevents it returning.
  - [x] Move project adoption, popout, and merge off the broad application
    preload API. The renderer now receives only the frozen versioned
    `terminayWorkspaceTransferHost` with those three named operations;
    Electron validates trusted sender, exact request envelopes, bounded
    transfer payloads, coordinates, and target-window ids before retaining
    native transfer authority. The retired `app:get-adopted-project`,
    `app:popout-project`, and `app:merge-project` routes and broad preload
    methods are absent. `scripts/workspace-transfer-host-bridge.test.mjs`
    guards the migration and absence boundary.
  - [x] Move native app-command subscription off the broad application preload
    API. The renderer now receives only the frozen versioned
    `terminayAppCommandHost.subscribe(listener)` capability, which forwards
    only the closed native command union and ignores malformed event payloads.
    The retired `window.terminay.onAppCommand` method is absent.
    `scripts/app-command-host-bridge.test.mjs` guards the migration.
  - [x] Move legacy terminal-recording lifecycle/data compatibility off the
    broad application preload API. The renderer entry now snapshots only the
    frozen versioned `terminayRecordingServiceHost`; Electron validates trusted
    senders plus exact or bounded versioned request envelopes for state,
    lifecycle, list, chunk, delete, and reveal operations. The retired
    `terminal-recording:*` handlers and `window.terminay` recording methods
    are absent. `scripts/recording-service-host-bridge.test.mjs` covers the
    narrow migration and absence boundary.
- [x] Keep updater, menus, app lifecycle, OS integration, local credential
  storage, and server supervision in Electron. The focused
  `electron-host-ownership.test.mjs` boundary keeps native menu/update/lifecycle
  ownership in Electron main, Local supervision independent of renderer
  lifetime, and credential storage behind the privileged host adapter.
  - [x] Restrict server-bundle native menu requests to the exact command ids
    advertised by the current host presentation, and deny them when native-menu
    integration is unavailable. `DesktopHostBridgeRouter` makes the native
    shell—not the server bundle—the authority for the available command set;
    `host-bridge.test.mjs` covers allowed, unadvertised, and unavailable menu
    states.
  - [x] Require both `nativeWindows` and `osIntegration` host capabilities for
    server-bundle native menu dispatch, so a presentation advertisement cannot
    restore OS integration after the host withdraws it. Focused coverage in
    `apps/terminay-desktop/test/host-bridge.test.mjs` proves the request is
    denied without either capability.
  - [x] Move the current workspace update-link action off the broad shell
    preload API. The renderer now receives only the versioned
    `terminayExternalHost.open(url)` capability; Electron validates a trusted
    top-level sender and the exact `{ version: 1, url }` envelope before its
    existing credential-free HTTPS shell policy opens the URL. Focused
    coverage in `scripts/external-host-bridge.test.mjs` proves the production
    workspace does not call `window.terminay.openExternal` for the update
    action and the narrow bridge rejects malformed envelopes.
  - [x] Move terminal hyperlink activation off the broad shell preload API.
    `TerminalPanel` now invokes the same versioned
    `terminayExternalHost.open(url)` bridge only after its existing
    modifier-click/duplicate-suppression interaction gate; it cannot call
    `window.terminay.openExternal` directly. The focused external-host bridge
    test covers both the workspace update action and terminal link path.
  - [x] Move terminal zoom presentation off the broad preload API. The
    renderer now reads zoom only through the versioned, read-only
    `terminayTerminalPresentationHost.getZoom()` bridge; Electron retains
    terminal-presentation ownership and validates the trusted sender before
    returning its bounded native zoom level. Focused coverage in
    `scripts/terminal-presentation-host-bridge.test.mjs` prevents the legacy
    `terminal:get-zoom` channel and broad renderer call from returning.
  - [x] Move terminal copy/paste off the broad preload API. `TerminalPanel`
    now has only the versioned `terminayClipboardHost.readText/writeText`
    capability, while Electron validates the trusted top-level sender, exact
    envelope shape, version, and bounded text before interacting with the OS
    clipboard. `scripts/terminal-clipboard-host-bridge.test.mjs` prevents the
    terminal renderer from returning to `window.terminay` clipboard methods.
  - [x] Remove the obsolete broad clipboard IPC and preload methods after all
    production renderer callers moved to the versioned
    `terminayClipboardHost`. The remaining workspace, Git, and folder copy
    actions use only `readText`/`writeText`; Electron validates the sender,
    versioned envelope, and text bound at that host boundary. Focused coverage
    in `scripts/terminal-clipboard-host-bridge.test.mjs` proves the legacy
    `clipboard:smart-paste` and `clipboard:write-text` channels, preload
    methods, and renderer calls are absent.
  - [x] Move production workspace **Reveal in OS** actions off the broad
    preload API. The current workspace, folder, task, and Git-worktree
    surfaces now use only the versioned `terminayRevealHost.reveal(filePath)`
    capability; Electron validates a trusted top-level sender, exact envelope,
    bounded absolute path, and retains the sole `shell.showItemInFolder`
    authority. `scripts/reveal-host-bridge.test.mjs` proves the broad
    `shell:reveal-in-os` IPC/preload method and production renderer calls are
    absent.
  - [x] Remove the retired broad external-link IPC and preload method after
    every production renderer link moved to `terminayExternalHost.open`. The
    update surface, terminal hyperlinks, Quick Push pull-request link, and
    Markdown HTTPS links now use the same validated versioned bridge; the
    legacy `shell:open-external` route and `window.terminay.openExternal`
    capability are absent. `scripts/external-host-bridge.test.mjs` covers the
    migration and absence boundary.
  - [x] Move opening the native recordings window off the broad application
    preload API. Workspace commands now use only the versioned
    `terminayRecordingsHost.open()` capability; Electron validates the trusted
    sender and exact `{ version: 1 }` envelope before retaining sole native
    window authority. `scripts/recordings-host-bridge.test.mjs` prevents the
    retired `app:open-recordings` route, preload method, and renderer call from
    returning.
  - [x] Move native settings-window opening off the broad application preload
    API. Workspace actions now use only the versioned
    `terminaySettingsWindowHost.open(sectionId?)` capability; Electron validates
    the trusted sender, exact versioned envelope, and bounded optional section
    id before retaining the sole settings-window authority. The retired
    `app:open-settings` route and `window.terminay.openSettingsWindow` method
    are absent. `scripts/settings-window-host-bridge.test.mjs` guards the
    narrow migration and absence boundary.
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
