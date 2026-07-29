# Shared responsive server UI

## Goal

Replace the separate desktop and terminal-only remote applications with one
complete responsive workspace UI bundled by every server and driven entirely
through `TerminayClient`.

## Governing specifications

- [Connections and client hosts](../features/connections-and-client-hosts.md)
- [Server-owned workspace state](../features/server-owned-workspace-state.md)
- All existing workspace feature specifications.

## Why this is active

`src/App.tsx` is a large desktop-oriented renderer coupled to
`window.terminay`, while `src/remote/App.tsx` is a second terminal-only UI with
separate state, settings, navigation, and protocol. Continuing both would
duplicate every new feature and produce incompatible behaviour.

## Dependencies

- [Desktop connection host and Local mode](../tasks_completed/7-desktop-connection-host-and-local-mode.md)
- [Server terminal service](../tasks_completed/8-server-terminal-service.md)
- [Server activity and agent services](../tasks_completed/9-server-activity-and-agent-services.md)
- [Server MCP control](../tasks_completed/10-server-mcp-control.md)
- [Server files and file viewer](../tasks_completed/11-server-files-and-file-viewer.md)
- [Server Git, worktrees, and Quick Push](../tasks_completed/12-server-git-worktrees-and-quick-push.md)
- [Server recordings](../tasks_completed/13-server-recordings.md)
- [Server settings, secrets, and macros](../tasks_completed/14-server-settings-secrets-and-macros.md)
- [Server AI metadata and dictation](../tasks_completed/15-server-ai-and-dictation.md)

## Work slices

### Client architecture

- [x] Add a bounded query/command feature facade and migrate the file-diff
  query through a host-local compatibility adapter; keep the broader renderer
  migration and full feature parity work explicit below.
- [x] Extract connection-independent `TerminayClient` queries, commands,
  subscriptions, caches, conflict handling, and reconnect state from React.
  Canonical renderer feature code now contains zero raw
  `TerminayClient.query`/`command`/`subscribe` calls: browser readiness uses
  `ServerHealthClient`, and Desktop/browser feature composition reuses one
  `TerminayClientFacade` for envelope unwrapping plus awaited, resync-aware
  subscriptions. Remaining `window.terminay*Host` calls are explicitly native
  host capabilities (window/presentation lifecycle, clipboard/reveal,
  filesystem watch/drop/size, microphone/keystore, and connection pairing),
  not connection-independent server operations. Evidence:
  `packages/client-core/src/health.ts`,
  `packages/client-core/src/queryCommand.ts`,
  `src/shared/rendererServerClient.ts`, `src/web/main.tsx`,
  `packages/client-core/test/health.test.mjs`, and
  `packages/client-core/test/query-command.test.mjs`.
  - [x] Add a transport-neutral `RecordingsClient` facade for canonical list,
    bounded replay, lifecycle commands, list caching, and mutation invalidation.
  - [x] Migrate the Recordings timeline window to `RecordingsClient` through a
    compatibility-only preload adapter; replay, delete, reveal, and list calls
    no longer access `window.terminay` from the shared component.
  - [x] Migrate App terminal recording lifecycle commands, state hydration, and
    updates through the existing `RecordingsClient` compatibility adapter; the
    native recordings-window navigation remains outside this bounded slice.
  - [x] Migrate App AI tab metadata generation through the shared
    `TerminayAiClient` compatibility adapter; the legacy preload translation is
    isolated to `src/services/ai/legacyAiTabMetadataClient.ts`.
  - [x] Migrate Settings AI model discovery through the same bounded AI
    compatibility client; provider validation remains at the preload boundary
    and the settings renderer no longer calls the broad preload model-list API.
    Evidence: `src/components/SettingsWindow.tsx`,
    `src/services/ai/legacyAiTabMetadataClient.ts`, `electron/preload.ts`, and
    `scripts/ai-tab-metadata-client-path.test.mjs`.
  - [x] Move Desktop remote-access status and lifecycle controls behind one
    narrow validated native capability; App and Settings no longer use the
    broad preload status, toggle, revoke, close, or pairing-address methods.
    Evidence: `electron/preload.ts`, `src/App.tsx`,
    `src/components/SettingsWindow.tsx`, and
    `scripts/task19-remote-access-status-host.test.mjs`.
  - [x] Migrate Performant text metadata and ranged line loading to the bounded
    `FileViewerClient` facade; legacy preload access remains isolated in the
    file-viewer compatibility transport.
  - [x] Migrate the terminal-settings hook's read/change subscription to
    `SettingsClient`; preload settings methods and event payloads remain only
    in its compatibility transport.
  - [x] Migrate the workspace sidebar preference and remote pairing-mode
    read/update paths through the hook's shared `SettingsClient`; `App.tsx` no
    longer calls preload terminal-settings methods directly. Evidence:
    `src/App.tsx` and `scripts/task14-settings-client-path.test.mjs`.
  - [x] Migrate FilePanel's ranged text probing, sparse saves, and diff-layout
    setting update through the shared file/settings clients; direct preload
    access is absent from the component. Connected sparse saves retain
    server-owned reads and obtain the host inode/mtime revision only at the
    narrow compatibility mutation boundary. Evidence:
    `src/components/file-viewer/FilePanel.tsx` and
    `scripts/file-viewer-shared-client.test.mjs`.
  - [x] Migrate workspace file creation and terminal-working-directory file
    inspection through the shared `terminayFileGateway`; these App paths no
    longer access preload file save/metadata methods directly. Evidence:
    `src/App.tsx` and `scripts/file-viewer-shared-client.test.mjs`.
  - [x] Migrate workspace directory listing through `FileViewerClient`; the
    legacy Desktop directory API is isolated in the file-viewer compatibility
    transport and `App.tsx` consumes the bounded catalog page. Evidence:
    `src/services/fileViewer/legacyFileViewerTransport.ts`, `src/App.tsx`, and
    `scripts/file-viewer-shared-client.test.mjs`.
  - [x] Move workspace directory-watch subscribe/watch/unwatch lifecycle onto
    the narrow versioned file-explorer host capability; `App.tsx` no longer
    accesses the broad preload directory-watch methods. Evidence:
    `electron/preload.ts`, `src/App.tsx`, and
    `scripts/file-explorer-host-bridge.test.mjs`.
  - [x] Migrate the remaining FolderPanel directory catalog through
    `FileViewerClient` and move native folder-size, watch, and dropped-file-path
    operations and Desktop file search onto the validated file-explorer host;
    connected folder-size derivation and task refresh now use the typed,
    project-scoped `FileObservationClient` event streams before any
    disconnected Desktop fallback, while
    native dropped-path handling stays host-owned; no feature component calls
    the broad preload API directly. Evidence: `src/components/TerminalPanel.tsx`,
    `src/components/folder-viewer/FolderPanel.tsx`, `electron/preload.ts`,
    `scripts/file-explorer-host-bridge.test.mjs`, and
    `scripts/terminal-drop-interaction.test.mjs`.
  - [x] Migrate workspace rename, recursive delete, and directory creation
    through `FileViewerClient` canonical catalog commands; Desktop filesystem
    mutations remain isolated in the legacy file-viewer transport. Evidence:
    `packages/client-core/src/fileViewer.ts`,
    `src/services/fileViewer/legacyFileViewerTransport.ts`, `src/App.tsx`, and
    `scripts/file-viewer-shared-client.test.mjs`.
  - [x] Move terminal edit-window launch onto a narrow versioned Desktop host
    capability; the shared edit form/result boundary remains host-neutral and
    `App.tsx` no longer calls the broad preload launcher. Evidence:
    `electron/preload.ts`, `src/App.tsx`, and
    `scripts/task19-edit-window-capability.test.mjs`.
  - [x] Move legacy path-based Git status/worktree presentation operations
    behind one narrow validated Desktop host capability; canonical server Git
    operations remain on `TerminayGitClient`, while `App.tsx` no longer calls
    the broad preload Git/worktree methods. Evidence: `electron/preload.ts`,
    `src/App.tsx`, and `scripts/git-worktree-host-bridge.test.mjs`.
  - [x] Move Desktop microphone permission, host-keystore dictation credential,
    and transcription calls behind one narrow validated native host capability;
    the workspace and settings renderers no longer call the broad preload
    dictation methods. Evidence: `electron/preload.ts`, `src/App.tsx`,
    `src/components/SettingsWindow.tsx`, and
    `scripts/dictation-host-bridge.test.mjs`.
  - [x] Route the remaining Desktop macro secret-step lookup through the
    bounded macro-settings compatibility capability; `App.tsx` no longer
    reaches into the broad preload secret API. Evidence:
    `src/services/macros/legacyMacroSettingsCapability.ts`, `electron/preload.ts`,
    `src/App.tsx`, and `scripts/task14-settings-client-path.test.mjs`.
  - [x] Static boundary coverage verifies these migrated components keep
    preload/host transport calls inside compatibility adapters.
- [x] Add the transport-neutral `TerminayTerminalPanelClient` stream boundary;
  raw output remains bytes and panel commands remain attachment-scoped.
- [x] Replace direct `window.terminay` and remote socket calls with that client.
  - [x] Add a compatibility-only `DesktopTerminalAuthorityAdapter` for
    non-panel terminal input/resize/kill calls; it requires immutable terminal
    identity and rejects renderer/window ownership fields. All production
    `App.tsx` call sites now enter the exact panel attachment queue instead;
    the obsolete adapter/terminal IPC surface has been deleted.
  - [x] Move the legacy remote workspace's session attach/detach, input,
    resize, connect, and close calls behind `RemoteTerminalClient`; focused
    coverage verifies its session-scoped envelopes, validation, and renderer
    boundary in `scripts/remote-terminal-client.test.mjs`.
  - [x] Enforce the completed renderer boundary source-wide: production feature
    modules contain no broad `window.terminay` calls, `TerminalPanel` writes and
    resizes only through its exact shared-client attachment, and the legacy
    remote renderer contains neither raw socket sends nor `WebSocket`
    construction. Evidence: `scripts/terminal-authority-boundary.test.mjs`.
- [ ] Make the production Electron and web hosts render the same extracted
  workspace component tree. The current Electron host still supplies
  `src/App.tsx` as `legacyFallback`, while the web host supplies
  `ServerWorkspaceSurface`; sharing a route marker, content frame, shell
  model, or renderer-neutral panel contracts is not component-tree reuse.
  Evidence reset:
  `specs/decisions/evidence/task16-production-ui-parity-reset.md` and
  `scripts/task16-production-ui-parity-gate.test.mjs`.
- [x] Split `src/App.tsx` into feature-owned components/stores without
  recreating separate desktop/mobile application trees. Project tabs,
  collection/edit/transfer, file-tree/catalog/Git/worktree/Quick Push,
  connection/remote access, macros, recording/activity/dictation, terminal
  creation/adoption/transfer/switching/control, Dockview lifecycle, and
  popout/header-window orchestration now live behind feature-owned modules
  while Desktop and browser retain one shared application tree. Evidence:
  `scripts/task16-app-feature-ownership.test.mjs` (33 ownership and behavior
  assertions), `e2e/terminal-active-presentation.spec.ts`, and the focused
  agent-status regression covering numbered terminal activation.
- [x] Delete the duplicate remote terminal workspace once parity is proven.

### Responsive workspace

- [ ] Render projects, logical workspace views, Dockview panels, sidebars,
  terminal/file/folder tabs, agents, Git, settings, recordings, macros, and
  command surfaces from one server model.
  - [x] Hydrate the production shared `App` project collection—including each
    project root—from the authenticated workspace snapshot. Browser project
    creation must use `WorkspaceClient` rather than synthesizing a local
    `project-N` tab with an empty root. Connected project tabs now reconcile
    server ids/names/roots from `WorkspaceSnapshotStore`, create projects
    through `WorkspaceClient`, and fall back to a bounded `.` root rather than
    sending an invalid empty root during empty-workspace recovery. Evidence:
    `src/workspace/useProjectCollection.ts`,
    `src/shared/WorkspaceSnapshotStore.ts`,
    `packages/client-core/src/workspace.ts`, and
    `scripts/workspace-project-collection-authority.test.mjs`.
  - [ ] Prove the rebuilt browser Explorer can list the selected server project
    root, open/edit a file through `FileViewerClient`, and render Git/worktree
    state through `TerminayGitClient`. An empty `rootFolder` must not silently
    turn Explorer and Git into blank panels.
  - [ ] Make browser restart recovery persistent and truthful: protocol 502 or
    event-stream loss must leave the connected presentation, show an
    unreachable/reconnecting state, retry with bounded backoff until the server
    returns or the user cancels, and then restore the server-owned workspace
    and terminal state. One retry after 750 ms is insufficient.
  - [ ] Prevent the Explorer/sidebar from triggering an `activity.snapshot`
    render/effect feedback loop. Toggling or resizing the sidebar must keep
    activity refreshes bounded, must not create hundreds of pending protocol
    requests, and must not crash or exhaust Chrome.
  - [ ] Restore smooth connected-browser command menu interaction. Scrolling
    the Cmd+L menu must stay responsive under the shared App renderer, avoid
    a render/effect feedback loop, and keep paint/event-processing jank within
    the shared browser stability budget.
  - [x] Restore Cmd+R / command-menu project-root updates from the active
    terminal working directory in connected browser mode. Selecting
    "Set project root folder to working directory" after `cd web` must persist
    the server-owned project root to that exact active terminal CWD and refresh
    Explorer/Git consumers without stale-root presentation.
  - [x] Simplify and fix the connected-browser file Explorer sidebar resize
    boundary. The sidebar must behave like the Electron app: one resizable left
    panel directly adjacent to Dockview, smooth drag, configured min/max width,
    persisted width, and no duplicate/ghost resize handles, overlay gutters, or
    terminal overlap. The shared workspace split now owns the single boundary:
    the separator is an overlaid hit target rather than a grid gutter, pointer
    dragging clamps and commits the controlled width, and focused Chromium
    geometry/interaction coverage proves Dockview content starts at the sidebar
    edge without a ghost gap (`src/shared/WorkspaceSplitLayout.tsx`,
    `src/shared/WorkspaceSplitLayout.css`,
    `scripts/workspace-split-layout-computed.test.mjs`,
    `scripts/web-shared-workspace.test.mjs`).
  - [ ] Add a fail-fast browser stability budget before any further live
    acceptance run. Instrument shared-App/ProjectWorkspace renders, protocol
    request starts/completions, pending requests, console resource errors, and
    long-task/CPU-facing activity; abort the scenario immediately when a
    bounded threshold is exceeded and retain diagnostics instead of allowing
    Chrome or the host machine to become unresponsive.
  - [ ] Make saved reconnect credentials survive a normal server-container
    restart. A valid persisted reconnect grant must complete its challenge and
    proof flow after restart; an actually invalid or revoked proof must stop
    retrying, clear stale connected state, and ask for a fresh pairing URL.
  - [ ] Make connection status atomic and truthful across refresh/restart.
    Success, reconnecting, unreachable, invalid-proof, and fresh-pairing
    messages must be mutually exclusive; a profile must never say `connected`
    beside a reconnect error or retain stale `Switched to ...` success text.
  - [ ] Verify refresh and automatic reconnect repeatedly in the real Chrome
    production page. Refreshing while connected must restore the shared
    workspace without reopening the connection dialog, duplicating clients,
    flooding requests, or requiring a new pairing URL.
  - [ ] Accept both supported local browser origins in the production Compose
    path. Opening the web host at `http://localhost:8080` or
    `http://127.0.0.1:8080` must use the same bounded protocol authorization
    path and must not produce `/protocol` 403s solely because of the loopback
    hostname.
  - [ ] Stop retry and reload storms after permanent protocol authorization
    failures. A 400/401/403/404 handshake, reconnect, or protocol failure must
    transition to one stable fresh-pairing/error state, clear stale reconnect
    state when appropriate, and stop repeated `/protocol` requests until the
    user submits a new pairing URL or selects a valid saved profile.
  - [ ] Remove production browser console regressions. The built web host must
    load all referenced module assets and satisfy its CSP in supported
    browsers; refresh must not emit inline-script CSP violations, failed
    module loads, repeated navigations, or generic transport-error banners.
  - [x] Expose the browser Explorer file-watch protocol used by the shared
    App. The connected web UI must not show
    `Terminal error: Failed to watch files: ClientError: unknown operation
    files.watch.start`; the standalone server composition must advertise and
    handle every `files.*` operation the shared Explorer starts on connect,
    refresh, folder expansion, and sidebar resize. The shared Explorer now
    registers server watches and reacts to watch events only; it no longer runs
    a browser-side reconciliation loop over expanded folders, and a failed watch
    registration performs one bounded folder refresh without surfacing a global
    terminal error or retry storm. Evidence:
    `src/workspace/useFileExplorerController.ts`,
    `scripts/task16-file-explorer-bounded-load.test.mjs`, and
    `apps/terminay-server/test/standalone-http-transport.test.mjs`.
  - [ ] Restore connected browser terminal typing. The active terminal panel
    must keep keyboard focus, accept normal text and control keys, send each
    input event through the exact attached server-owned session, and render the
    resulting PTY output without requiring a click outside the terminal or a
    refresh. Partial fix: terminal stream delivery now rejects incomplete or foreign
    terminal events before decoding, so output produced by typing in a second
    same-browser terminal cannot raise `terminal event identity mismatch` and
    close the shared HTTP transport. Evidence:
    `packages/client-core/src/terminal.ts`,
    `packages/client-core/test/terminal-client.test.mjs`,
    `packages/client-core/test/http-byte-transport.test.mjs`,
    `scripts/terminal-panel-context.test.mjs`, and
    `scripts/terminal-panel-input-queue.test.mjs`.
  - [ ] Stop Explorer folder double-click crashes in connected web mode. Opening
    a folder from the browser Explorer must use connected file clients only and
    must never throw `disconnected file compatibility provider is unavailable`,
    blank the app, or fall back to Desktop-only disconnected file providers.
  - [ ] Deduplicate loopback saved-server profiles and reconnect credentials.
    `localhost:4317` and `127.0.0.1:4317` must resolve to the same local
    server profile/credential identity, refresh must reconnect automatically,
    and the dialog must not show one loopback profile as `connected` while the
    other says `unreachable` or asks for a fresh pairing URL.
  - [x] Mount the intended project workspace into the local server container,
    set the canonical server project root to that mount, and include the Git
    runtime required by the Git/worktree panels. Do not expose an inaccessible
    host path or `/opt/terminay` as the browser project root. Root and packaged
    local Compose preserve the linked-worktree host path, seed
    `TERMINAY_PROJECT_ROOT`, and admit only that exact Git safe directory; the
    non-root/read-only/capability-free container passed live
    `workspace.snapshot`, `files.list`, and `git.status` queries against this
    checkout. Evidence: `scripts/docker-compose-web-server-smoke.test.mjs` and
    `specs/decisions/evidence/docker-compose-web-server-smoke.md`.
  - [ ] Make Explorer expansion and loading stable. Expanding a directory must
    resolve once, replace its `Loading...` row, render children without
    duplicate requests, and preserve expansion/scroll state through ordinary
    sidebar renders.
  - [x] Stabilize Explorer Git status rendering through ordinary sidebar
    refresh and connected-client churn. Transient Git/server refresh failures
    must preserve the last good projection, identical Git/worktree projections
    must not trigger repaint state updates, and Git state may only clear on a
    real project/root switch. Evidence:
    `src/workspace/useFileExplorerController.ts` and
    `scripts/file-explorer-git-status-stability.test.mjs`.
  - [x] Fix wide sidebar resizing in the actual browser App. Dragging the
    workspace separator must continuously resize the sidebar and Dockview
    content, honor the configured min/max width, persist the committed width,
    and avoid the large unused right-hand padding shown in the live screenshot.
    The implementation is one simple left-panel boundary, not overlapping
    legacy/custom/Dockview resizers. Evidence:
    `scripts/workspace-split-layout-computed.test.mjs` renders the shared split
    in Chromium, drags the separator from 280px to 400px, and asserts both the
    live layout and committed width.
  - [x] Remove the excessive visual gap at the sidebar's right edge. The
    Explorer rows, nested content, scrollbar, resize handle, and adjacent
    Dockview panel must meet at a deliberate compact boundary at both default
    and user-resized widths, without a wide empty strip, blue ghost bar, or
    double gutter overlapping the terminal. Evidence:
    `scripts/workspace-split-layout-computed.test.mjs` checks default and
    resized widths, including 352px, 280px, and 640px, and verifies the content
    left edge equals the navigation right edge while the 6px resize hit target
    overlays that boundary.
  - [ ] Fix vertical sidebar pane sizing. Explorer, Agents, and Git panes must
    share the available height without large unexplained blank regions; their
    horizontal splitters must resize and persist pane heights without clipping
    the Git/worktree content below the viewport.
  - [ ] Make new terminal tabs work in the connected browser App. The `+`
    control must create exactly one server-owned session in the active
    canonical project, attach it once, select its Dockview tab, accept input,
    and survive refresh/reconnect without a duplicate or empty local tab.
  - [ ] Make new project tabs work in the connected browser App. The project
    `+` control must create exactly one project through `WorkspaceClient`,
    reconcile its canonical id/root/name into the shared tab strip, select it,
    create/open its initial terminal as designed, and survive refresh without
    reverting to a synthetic local project.
  - [x] Make project tab close server-owned and cascading. Closing a project
    must close its panels/tabs, terminate its project-owned terminal sessions,
    remove terminal session records from the workspace snapshot, delete the
    project, and select the next remaining project instead of surfacing
    `project must be empty before close` or resurrecting the tab on the next
    snapshot. Evidence: `packages/server-core/src/workspace.ts`,
    `packages/server-core/src/workspaceProtocol.ts`,
    `packages/server-core/src/composition.ts`,
    `packages/server-core/test/workspace.test.mjs`, and
    `packages/server-core/test/server-composition.test.mjs`.
  - [ ] Make terminal input, resize, and output remain responsive while the
    sidebar is opened, resized, expanded, or refreshed. No sidebar interaction
    may leave terminal protocol requests pending or surface generic
    `HTTP transport request failed` banners.
  - [ ] Fix CMD+L command-surface scroll jank. Opening and scrolling the
    command-surface menu in the production browser App must not cause repeated
    refresh/paint churn, long main-thread event-processing delays, or visible
    scroll lag; add a focused regression or bounded profiler-style smoke check
    before marking this complete.
  - [ ] Restore CMD+R/set-root-to-CWD in connected browser mode. Running the
    command-surface action after `cd` in the active terminal must query the
    exact server-owned terminal cwd, update the canonical project root, refresh
    Explorer/Git/workspace projections to that root, and preserve terminal
    attachment/input without stale root labels.
  - [ ] Add a real production-browser regression covering connect, refresh,
    Explorer toggle/resize/directory expansion, file open, Git ready state,
    terminal command/output, server restart, automatic reconnect, and a second
    refresh. Assert bounded request counts, no browser console/resource errors,
    no contradictory status text, and no generic transport-error banner.
  - [x] Define one shared, renderer-neutral Dockview panel/sidebar navigator
    for wide and narrow hosts. It consumes bounded server-owned panel entries,
    preserves accessible listbox selection, rejects stale or disabled selected
    panels, and exposes 44px panel/retry intents without importing Dockview, a
    host, or a transport. Evidence:
    `packages/shared-ui/src/components/DockviewPanelNavigatorPanel.mjs` and
    its direct component tests.
  - [x] Define one shared, renderer-neutral terminal/file/folder workspace tab
    strip for wide and narrow hosts. It consumes bounded server-owned tab
    entries, preserves accessible tab selection, exposes 44px select/close/
    retry intents, and never imports a host, Dockview, or transport. Evidence:
    `packages/shared-ui/src/components/WorkspaceTabStripPanel.mjs` and its
    direct component tests.
  - [x] Define one shared, renderer-neutral project and logical-workspace-view
    navigator for wide and narrow hosts. It consumes bounded server-owned
    project/view selections, preserves accessible listbox/tablist semantics,
    uses 44px selection intents, and exposes no host or transport dependency.
    Evidence: `packages/shared-ui/src/components/WorkspaceViewNavigatorPanel.mjs`
    and its direct component tests.
  - [x] Define one shared, renderer-neutral workspace empty/error state panel
    for wide and narrow hosts. It distinguishes loading, no-projects,
    project-local no-panels, unavailable, and retryable failed state; carries
    only canonical server/project identifiers; preserves polite versus
    assertive status semantics; and exposes one 44px create/open/retry intent
    without importing a host or transport. Evidence:
    `packages/shared-ui/src/components/WorkspaceEmptyStatePanel.mjs` and its
    direct component tests.
  - [x] Define one shared, renderer-neutral folder-browser state panel for wide
    and narrow hosts. It distinguishes loading, ready, empty, unavailable,
    forbidden, and retryable failed state; bounds folder entry identities and
    labels; preserves selected entries through accessible tree semantics; and
    exposes 44px select/retry intents without importing a filesystem client,
    host, or transport. Evidence:
    `packages/shared-ui/src/components/FolderBrowserPanel.mjs` and its direct
    component tests.
  - [x] Define one shared, renderer-neutral command-surface state panel for
    wide and narrow hosts. It bounds server-provided command identities,
    labels, shortcuts, query text, and result count; distinguishes ready,
    empty, unavailable, and retryable failed state; preserves accessible
    searchbox/listbox semantics; and exposes 44px command/retry intents
    without importing a command registry, host, or transport. Evidence:
    `packages/shared-ui/src/components/CommandSurfacePanel.mjs` and its direct
    component tests.
- [x] Define wide, medium, and narrow layouts using container/media queries and
  host capability inputs.
- [x] Replace native-window-only actions with logical view navigation on web.
- [x] Add touch terminal accessory, virtual keyboard/viewport, accessible
  drawers/selectors, and large touch targets without reducing desktop keyboard
  functionality. The responsive-ui models cover the touch accessory,
  visual-viewport keyboard geometry, ARIA drawer/selector contracts, and 44px
  touch targets while preserving physical desktop keyboard input.
  - [x] Define a host-neutral terminal accessory model with an allowlisted
    Escape/Tab/modifier/navigation key set and a desktop-keyboard preservation
    contract; focused coverage lives in
    `packages/responsive-ui/test/ui.test.mjs`.
  - [x] Project visual-viewport measurements into bounded shell/terminal
    geometry, detect software-keyboard insets, prevent horizontal overflow, and
    restore the pre-keyboard shell height.
  - [x] Define ARIA combobox/listbox and modal-drawer contracts with bounded
    disabled-option keyboard navigation, Escape handling, and focus restoration.
  - [x] Require 44px minimum touch targets across the responsive accessory,
    drawer, and selector models.
- [x] Preserve focus, reduced motion, screen reader, theme, and terminal safety.
  The host-neutral accessibility/safety models cover focus restoration,
  reduced-motion policy, color-scheme/forced-colors hints, polite status
  announcements with terminal output `aria-live="off"`, and bounded accessory
  input/terminal geometry.
  - [x] Resolve host-provided reduced-motion, color-scheme, forced-colors, and
    screen-reader hints into one immutable policy; reduced motion removes
    transitions without removing keyboard access, and terminal output is not
    announced as a live stream.
  - [x] Preserve drawer focus by modelling the initial focus target and the
    trigger restoration target; missing targets leave focus unchanged rather
    than causing an unsafe focus jump.
  - [x] Expose host-neutral screen-reader semantics with polite status
    announcements and `aria-live="off"` terminal output, covered by focused
    responsive-ui tests.
  - [x] Bound touch-terminal accessory input to an allowlist and cap terminal
    geometry while preserving unrestricted physical keyboard input.

### Shared routes and host capabilities

- [x] Turn settings, macros, recordings, and edit surfaces into shared
  route/component entries.
  - [x] Define one shared, renderer-neutral macro editor route contract for
    wide and narrow hosts. It bounds project/macro identity and draft label/body
    data, distinguishes loading, ready, saving, unavailable, forbidden, and
    retryable failed states, preserves accessible form/status semantics, and
    exposes 44px create/save/cancel/retry intents without importing macro
    storage, execution, a host, or a transport. Evidence:
    `packages/shared-ui/src/components/MacroEditorRoutePanel.mjs` and its
    direct component tests.
  - [x] Define one shared, renderer-neutral connect-to-server form for wide and
    narrow hosts. It represents exactly one canonical HTTP(S) server URL (not
    a Docker- or pairing-specific alternate input), bounds the value, rejects
    credentials and path/query/fragment material, exposes accessible idle,
    connecting, and retryable failure state, and supplies a 44px connect action
    without importing browser storage, credentials, a host, or a transport.
    Evidence: `packages/shared-ui/src/components/ConnectionFormPanel.mjs` and
    its direct component tests.
  - [x] Define one shared, renderer-neutral connection-switcher panel for wide
    and narrow hosts. It consumes only bounded saved-server metadata, preserves
    accessible listbox selection, horizontally scrolls on narrow hosts, and
    exposes 44px connect/select/remove/retry intents without importing browser
    storage, credentials, a host, or a transport. Evidence:
    `packages/shared-ui/src/components/ConnectionSwitcherPanel.mjs` and its
    direct component tests.
  - [x] Define the host-neutral route registry and in-page/native-auxiliary
    presentation policy.
  - [x] Extract the recordings library list, search, refresh, grouping, and
    selection chrome into a host-neutral shared route body. Desktop retains
    replay, deletion, persistence, and native presentation while the browser
    can reuse the same library component. Evidence:
    `src/shared/SharedRecordingsLibraryPane.tsx`,
    `src/components/RecordingsWindow.tsx`, and
    `scripts/shared-recordings-library-pane.test.mjs`.
  - [x] Extract the macro library header, create action, loading/empty state,
    selection, and reorder intent into a host-neutral summary-only shared route
    body. Desktop retains macro editing, secrets, persistence, and native
    presentation. Evidence: `src/shared/SharedMacroLibraryPane.tsx`,
    `src/components/MacrosWindow.tsx`, and
    `scripts/shared-macro-library-pane.test.mjs`.
  - [x] Define one immutable shared workspace shell render model that composes
    the route registry, responsive layout, connection menu, client snapshot,
    profile metadata, and host capabilities without importing a host or
    transport. Evidence: `createResponsiveWorkspaceShellModel` in
    `packages/responsive-ui/src/index.ts`, covered by
    `packages/responsive-ui/test/ui.test.mjs`.
  - [x] Activate the shared route registry at the production renderer entry;
    migrated routes expose the shared route and presentation metadata while
    their legacy feature body remains an explicit fallback. Evidence:
    `src/main.tsx`, `src/shared/ResponsiveWorkspaceEntry.tsx`, and
    `scripts/shared-responsive-entry.test.mjs`.
  - [x] Move the browser connected-workspace shell chrome out of
    `src/web/main.tsx` and into a shared React component. Evidence:
    `src/shared/ResponsiveWorkspaceShell.tsx`,
    `src/shared/ResponsiveWorkspaceShell.css`, and
    `scripts/web-shared-workspace.test.mjs`; the web host now supplies only the
    connection/session terminal body while the shared component owns the header,
    route rail, region markers, terminal region wrapper, and shared data
    attributes.
  - [x] Move the browser connected-workspace body to the shared,
    server-snapshot-driven workspace surface. `ServerWorkspaceSurface` loads
    the authenticated `workspace.snapshot`, derives project/panel/session
    identity from it rather than browser defaults, commits `panel.activate`
    through `WorkspaceClient`, and renders bounded terminal, file, and folder
    bodies through `TerminayTerminalPanelClient` and `FileViewerClient`.
    Evidence: `src/shared/ServerWorkspaceSurface.tsx` and
    `scripts/web-shared-workspace.test.mjs`. This is an initial shared panel
    surface, not a claim of full Dockview/feature parity.
  - [x] Both production hosts now use one host-neutral workspace content
    boundary: Desktop supplies its existing Dockview/sidebar body and the
    browser supplies its server-snapshot body. `WorkspaceContentFrame` owns no
    Electron, preload, transport, terminal, or Dockview dependency. Evidence:
    `src/shared/WorkspaceContentFrame.tsx` and
    `scripts/web-shared-workspace.test.mjs`. This is an extraction seam, not a
    claim that the two bodies have full feature parity yet.
  - [x] Render server-owned logical workspace view selection in the shared
    surface. The browser now derives its view rail, projects, and active panel
    navigation from `viewOrder`/`views` in the authenticated snapshot rather
    than always selecting the first view; narrow layouts retain a 44px,
    horizontally scrollable selector. Evidence:
    `src/shared/ServerWorkspaceSurface.tsx`,
    `src/shared/ResponsiveWorkspaceShell.css`, and
    `scripts/web-shared-workspace.test.mjs`.
  - [x] Refresh the shared workspace through a single-flight authenticated
    `snapshot`/`delta` lifecycle. Delta envelopes are unwrapped by the shared
    client facade; the surface rejects stale or structurally cross-owned state
    and reconciles its local view/project/panel selection to the latest
    server-owned graph. Evidence: `src/shared/serverWorkspaceReconciliation.ts`,
    `scripts/server-workspace-reconciliation.test.mjs`, and
    `scripts/web-shared-workspace.test.mjs`.
  - [x] Keep the shared server workspace current through a single-flight
    `workspace.snapshot`/`workspace.delta` lifecycle. The client facade unwraps
    the server delta envelope; the shared surface rejects stale or malformed
    snapshots and reconciles view/project/panel selection to the authoritative
    graph, including file-only and folder-only projects. Evidence:
    `packages/client-core/src/workspace.ts`,
    `src/shared/serverWorkspaceReconciliation.ts`, and focused workspace/web
    tests. This is snapshot reconciliation, not a claim of complete route or
    Dockview parity.
  - [x] Keep shared browser terminal attachments ordered and recoverable. The
    shared terminal surface owns a stable terminal client high-water mark,
    acknowledges rendered output, serializes bounded input, fails closed on
    transport errors, and resumes retained replay from the server-provided
    `replayFrom` boundary instead of a stale `0` cursor. Evidence:
    `src/shared/ServerWorkspaceSurface.tsx` and
    `scripts/web-shared-workspace.test.mjs`.
  - [x] Extract the Settings route body chrome into a host-neutral shared
    component without claiming full Settings parity. Evidence:
    `src/shared/SharedSettingsRouteBody.tsx`,
    `src/components/SettingsWindow.tsx`, and
    `scripts/shared-settings-route-body.test.mjs`; the component owns the
    reusable settings shell/sidebar/content slots and imports no Electron,
    xterm, transport, or `window.terminay` primitives while the Desktop route
    still owns persistence, preview, remote-access actions, and legacy feature
    body logic.
  - [x] Extract the Edit Tab form into a host-neutral shared route body. The
    shared component owns project/terminal validation, title/icon/colour
    controls, accessible form keyboard semantics, preview, and cancel/submit
    interactions; Desktop owns only privileged draft loading, result
    persistence, and native-window closing. Evidence:
    `src/shared/SharedEditTabRouteBody.tsx`,
    `src/components/EditTabWindow.tsx`, and
    `scripts/shared-edit-tab-route-body.test.mjs`.
  - [x] Complete the four-route body boundary: Desktop Settings, Macros,
    Recordings, and Edit entries all consume host-neutral shared React route
    bodies, and the same four components render without horizontal overflow in
    a browser at wide and narrow widths. Evidence:
    `src/shared/SharedSettingsRouteBody.tsx`,
    `src/shared/SharedMacroRouteBody.tsx`,
    `src/shared/SharedRecordingsRouteBody.tsx`,
    `src/shared/SharedEditTabRouteBody.tsx`,
    `scripts/shared-auxiliary-route-bodies.test.mjs`, and
    `e2e/shared-auxiliary-routes.spec.ts`.
- [ ] Render the complete shared route components in the actual Electron and
  web production trees, replacing host-specific feature bodies rather than
  testing renderer-neutral models or fixture-only route surfaces.
	- [x] Wire the production browser Recordings route to canonical
	  `RecordingsClient` list/delete operations through the authenticated
	  `TerminayClient`, with loading, empty, error, selection, refresh, and
	  detail states rendered in `SharedRecordingsRouteBody`. Evidence:
	  `src/shared/ServerWorkspaceSurface.tsx` and
	  `scripts/server-recordings-route.test.mjs`.
	- [x] Wire the production browser Settings route to canonical
	  `SettingsClient` get/update/reset operations through the authenticated
	  `TerminayClient`, with loading, retryable error, loaded, saving, and reset
	  states rendered in `SharedSettingsRouteBody`. Evidence:
	  `src/shared/ServerWorkspaceSurface.tsx` and
	  `scripts/server-settings-route.test.mjs`.
	- [x] Wire the production browser Macros route to canonical `MacroClient`
	  get/replace/reset operations through the authenticated `TerminayClient`,
	  with loading, empty, retryable error, selection, editing, saving, and reset
	  states rendered in `SharedMacroRouteBody`. Evidence:
	  `src/shared/ServerWorkspaceSurface.tsx` and
	  `scripts/server-macros-route.test.mjs`.
	- [x] Snapshot every accepted shared route panel as bounded, deeply frozen,
	  data-only state at the shared-UI composition boundary. Later host mutation,
	  callbacks, accessors, cyclic models, and non-plain objects are rejected or
	  cannot alter the composed renderer-neutral route model. Evidence:
	  `packages/shared-ui/src/components/SharedWorkspaceRoutePanel.mjs` and its
	  direct component tests.
	- [x] Render the complete renderer-neutral Workspace route through the shared
	  React route surface at wide and narrow browser widths. The surface preserves
	  the canonical tabs-through-workspace-state order, permits only the
	  registered navigation/status semantic exceptions, and forwards one
	  immutable terminal-recovery intent without a host, client, or transport.
	  Evidence: `src/shared/SharedWorkspaceRouteSurface.tsx` and
	  `e2e/shared-workspace-route-surface.spec.ts`.
	- [x] Render the composed shared route surface at the medium responsive width.
	  Medium uses the canonical wide feature-panel contracts within a compact
	  medium route shell, so a host cannot mix panel densities while retaining a
	  distinct 900px responsive contract with no horizontal page overflow.
	  Evidence: `src/shared/SharedWorkspaceRouteSurface.tsx` and
	  `e2e/shared-workspace-route-surface.spec.ts`.
	- [x] Render the registered Connections alert and Settings dictation-dialog
	  exceptions through the host-neutral shared React route surface. The
	  renderer preserves the route-scoped alert/modal semantics, rejects those
	  roles outside their registered slots, and emits only immutable
	  panel-scoped intents at wide and narrow widths. Evidence:
	  `src/shared/SharedWorkspaceRouteSurface.tsx` and
	  `e2e/shared-workspace-route-surface.spec.ts`.
	- [x] Render the shared macro editor, recording-detail, and edit-tab route
	  contracts through one host-neutral React surface. The surface consumes only
	  immutable renderer-neutral models, preserves polite status/form/list
	  semantics and 44px declarative intents at wide and narrow widths, and does
	  not import a server, transport, storage, Electron, or a native host.
	  Evidence: `src/shared/SharedRouteEditorSurface.tsx` and
	  `e2e/shared-route-editor-surface.spec.ts`.
	- [x] Render the shared macro editor, recording-detail, and edit-tab route
	  contracts at the medium responsive width. Medium keeps their canonical
	  wide panel contracts inside a compact 900px route shell, preserves the
	  same immutable intents and semantic regions, and prevents horizontal page
	  overflow. Evidence: `src/shared/SharedRouteEditorSurface.tsx` and
	  `e2e/shared-route-editor-surface.spec.ts`.
	- [x] Render complete ready-state Recordings, Macros, File, and Git routes
	  through the same host-neutral shared React route surface at wide and narrow
	  browser widths. The surface preserves each route's canonical library/detail
	  or status/review panel order and emits only immutable panel-scoped intents;
	  it does not import a server, transport, storage, Electron, or native host.
	  Evidence: `src/shared/SharedWorkspaceRouteSurface.tsx` and
	  `e2e/shared-workspace-route-surface.spec.ts`.
	- [x] Render the terminal panel's canonical non-live output-region artifact
	  through the shared Workspace route at wide, medium, and narrow widths. The
	  surface permits that `role="log"`/`aria-live="off"` boundary only in the
	  registered terminal slot, so terminal byte output cannot become a host-
	  specific live announcement. Evidence:
	  `src/shared/SharedPanelContractSurface.tsx`,
	  `src/shared/SharedWorkspaceRouteSurface.tsx`, and
	  `e2e/shared-workspace-route-surface.spec.ts`.
	- [x] Render the canonical workspace tablist and folder tree artifacts
	  through the shared Workspace route instead of dropping them at the generic
	  React panel boundary. Selected tabs/treeitems preserve their ARIA state,
	  tab and folder actions remain immutable panel-scoped intents, and 44px
	  actions render at wide, medium, and narrow widths. Evidence:
	  `src/shared/SharedPanelContractSurface.tsx` and
	  `e2e/shared-workspace-route-surface.spec.ts`.
	- [x] Reject mutable or accessor-backed shared route models at the React
	  rendering boundary before any panel is rendered. This keeps the shared
	  surface bound to the composer's deeply frozen, data-only model even when a
	  host attempts to substitute a model between composition and render.
	  Evidence: `src/shared/SharedWorkspaceRouteSurface.tsx` and
	  `e2e/shared-workspace-route-surface.spec.ts`.
  - [x] Compose the real renderer-neutral workspace empty/failure state in the
    registered Workspace route without replacing its polite loading/empty
    status or assertive unavailable/failed alert semantics with a generic
    host-specific region. Evidence:
    `packages/shared-ui/src/components/SharedWorkspaceRoutePanel.mjs` and its
    direct component tests.
  - [x] Compose the renderer-neutral workspace tab strip, project/view
    navigator, and Dockview panel navigator in the registered Workspace route.
    The composer preserves their canonical tab-before-navigation order across
    wide and narrow hosts, while admitting navigation semantics only for the
    registered project/view selector. Evidence:
    `packages/shared-ui/src/components/SharedWorkspaceRoutePanel.mjs` and its
    direct component tests.
  - [x] Compose the renderer-neutral macro library/editor, recordings
    library/detail, and Git status/Quick Push contracts in their registered
    routes. The shared composer canonicalizes their semantic order and rejects
    cross-route panels while preserving one wide/narrow layout per route.
    Evidence: `packages/shared-ui/src/components/SharedWorkspaceRoutePanel.mjs`
    and its direct component tests.
  - [x] Compose the shared Settings route from the real renderer-neutral
    settings, MCP-control, and dictation contracts. The route permits the
    dictation overlay's semantic dialog only in its registered Settings slot,
    preserves canonical wide/narrow order, and rejects that dialog everywhere
    else. Evidence: `packages/shared-ui/src/components/SharedWorkspaceRoutePanel.mjs`
    and its direct component tests.
  - [x] Compose shared workspace activity, activity-notification, and AI
    tab-metadata panel contracts in the registered Workspace route. The route
    composer accepts only their renderer-neutral region models, applies the
    same wide/narrow layout, and canonicalizes their activity-before-terminal
    assistive-technology order across both hosts. Evidence:
    `packages/shared-ui/src/components/SharedWorkspaceRoutePanel.mjs` and its
    direct component tests.
  - [x] Compose the complete renderer-neutral Connections route from its
    canonical server form, saved-server switcher, and assertive
    connection-error contracts. The composer preserves form-before-switcher-
    before-error order at both widths and permits the alert semantic role only
    in its registered Connections slot. Evidence:
    `packages/shared-ui/src/components/SharedWorkspaceRoutePanel.mjs` and its
    direct component tests.
  - [x] Require and canonicalize the complete shared Workspace route at the
    ready route boundary: workspace tabs/views/Dockview navigation, activity,
    terminal, file, folder, agent, AI metadata, command surface, and workspace
    state contracts must all be present; loading/error sub-surfaces remain
    explicitly partial. Evidence:
    `createCompleteSharedWorkspaceRoutePanel` and its direct component tests.
  - [x] Require every registered Connections, Settings, Recordings, Macros,
    File, and Git route to provide its complete canonical panel set at the
    ready route boundary; partial ready routes fail closed rather than silently
    rendering an incomplete host-specific surface. Evidence:
    `createCompleteSharedWorkspaceRoutePanel` and
    `SharedWorkspaceRoutePanel.test.mjs`.
  - [x] Compose registered workspace routes from renderer-neutral feature-panel
    contracts only. The shared route composer bounds panel count, rejects a
    feature panel outside its registered route, preserves wide/narrow layout,
    and accepts no host, storage, transport, or privileged action. Evidence:
    `packages/shared-ui/src/components/SharedWorkspaceRoutePanel.mjs` and its
    direct component tests.
  - [x] Canonicalize the registered feature-panel order and require every panel
    model to use its enclosing route's wide/narrow layout. This keeps DOM and
    assistive-technology ordering stable across hosts while rejecting a mixed
    responsive contract before rendering. Evidence:
    `packages/shared-ui/src/components/SharedWorkspaceRoutePanel.mjs` and its
    direct component tests.
  - [x] Define one shared, renderer-neutral edit-tab route contract for wide
    and narrow hosts. It bounds project and terminal tab identities, appearance
    drafts, status and retry semantics, preserves accessible form/switch/slider
    semantics, and exposes 44px save/cancel/retry intents without importing
    draft persistence, native windows, a host, or a transport. Evidence:
    `packages/shared-ui/src/components/EditTabRoutePanel.mjs` and its direct
    component tests.
  - [x] Define one shared, renderer-neutral recording-detail route contract for
    wide and narrow hosts. It bounds project/recording identity and safe
    recording metadata, distinguishes loading, ready, unavailable, forbidden,
    and retryable failed states, and exposes 44px replay/delete/back/retry
    intents without importing recording storage, replay execution, a host, or
    a transport. Evidence:
    `packages/shared-ui/src/components/RecordingDetailRoutePanel.mjs` and its
    direct component tests.
  - [x] Add immutable shared route-component render models with complete
    semantic region contracts for every registered route; web keeps the model
    in-page and Desktop selects native-auxiliary presentation only when
    `nativeWindows` is available. Evidence: `createSharedWorkspaceRouteRenderModel`
    in `packages/responsive-ui/src/index.ts`, web/Desktop route adapters, and
    focused responsive/web/Desktop tests.
- [x] Let Desktop present eligible routes in native auxiliary windows while web
  presents them in-page. Evidence: `createSharedWorkspaceRouteEntries` and
  `createSharedWorkspaceRouteRenderModel` keep web routes in-page unless the
  host advertises `nativeWindows`; `createDesktopWorkspaceRouteRenderModel`
  opts Desktop settings into `native-auxiliary`; `createDesktopRendererContext`
  gates `openWindow` through the narrow native bridge. Covered by
  `packages/responsive-ui/test/ui.test.mjs`,
  `apps/terminay-desktop/test/desktop-presentation.test.mjs`, and
  `scripts/shared-responsive-entry.test.mjs`.
- [x] Capability-gate OS reveal, native dialogs, updater, and window actions
  with clear alternatives.
  - [x] Gate shared file selection on the host `filePicker` capability and
    fall back to the in-page File route when native dialogs are unavailable;
    covered by `createSharedFileSelectionModel` and
    `runSharedFileSelection` in `packages/responsive-ui`, with web/Desktop
    host adapter coverage.
  - [x] Gate shared `openWindow` actions on Desktop's `nativeWindows`
    capability and route accepted requests through the narrow versioned native
    bridge; covered by `createDesktopRendererContext` in
    `apps/terminay-desktop/src/renderer/index.ts` and
    `apps/terminay-desktop/test/desktop-presentation.test.mjs`.
  - [x] Gate Desktop OS integration and updater host actions at the versioned
    native bridge; `external.open` and `reveal` require `osIntegration`,
    `update.status` requires `updater`, unsafe release URLs are rejected, and
    unsupported hosts receive explicit capability errors instead of native
    action fallthrough. Covered by
    `apps/terminay-desktop/src/main/hostBridge.ts`,
    `apps/terminay-desktop/src/presentation.ts`, and
    `apps/terminay-desktop/test/desktop-presentation.test.mjs`.
- [x] Keep server workspace behaviour independent of whether a capability is
  present. Evidence: capability changes only affect presentation/action
  availability while preserving shared navigation, connection snapshot,
  remembered profiles, route registry, and route-component region contracts;
  covered by `packages/responsive-ui/test/ui.test.mjs`.

### Server bundle

- [x] Produce one content-hashed manifest containing the complete UI, assets,
  CSP requirements, server/protocol compatibility, and entry point.
  Evidence: the production `build:app` pipeline runs
  `scripts/build-ui-bundle-manifest.mjs` after Vite, inventories every regular
  emitted application file, records its SHA-256 hash/path/size/content type,
  derives the bundle id from the complete canonical inventory, and records the
  exact entry, CSP, server version, and protocol version. Determinism,
  completeness, compatibility metadata, content mutation, and unsafe-tree
  rejection are covered by `scripts/ui-bundle-manifest.test.mjs`; the real Vite
  output inventory is also checked during Task 16 completion.
  - [x] Verify that executable and stylesheet references from the declared HTML
    entry point resolve only to assets declared in the same content-addressed
    manifest; external, empty, and undeclared references fail closed. Covered
    by `packages/server-core/test/ui-bundle.test.mjs`.
  - [x] Normalize and verify the manifest's canonical self-only CSP requirement;
    Local serving emits the same policy and rejects bundle policy weakening,
    covered by `packages/server-core/test/ui-bundle.test.mjs` and
    `apps/terminay-server/test/committed-bundle-ui.test.mjs`.
  - [x] Launch Electron E2E from a per-run immutable copy of the generated
    renderer bundle rather than the shared `dist` directory. The fixture
    verifies every manifest-declared hash/size/path and complete file inventory
    before launch, makes staged assets read-only, and rechecks the exact
    fingerprint after shutdown so a parallel rebuild cannot create a mixed
    dynamic-import graph. Covered by
    `scripts/immutable-renderer-artifact.test.mjs` and the real
    `e2e/server-client-context.spec.ts` launch through `e2e/fixtures.ts`.
- [x] Load it from Local and through verified remote asset installation.
  Evidence: `apps/terminay-server/test/generated-ui-launch-paths.test.mjs`
  builds one production-format manifest, launches its unpacked bytes through
  Local, installs the same manifest and bytes through `UiBundleStore`, and
  launches only the verified committed snapshot.
  - [x] Resolve Vite root-relative application assets into the active verified
    content-addressed namespace for both unpacked Local bundles and remotely
    installed `UiBundleStore` commits; undeclared root-relative requests remain
    404 and failed installs retain the prior launchable bundle. Covered by
    `apps/terminay-server/test/local-ui-server.test.mjs` and
    `apps/terminay-server/test/committed-bundle-ui.test.mjs`.
- [x] Support direct standalone session-origin launch and host-shell embedded
  mode.
  Evidence: `apps/terminay-server/test/generated-ui-launch-paths.test.mjs`
  launches the exact same generated entry, executable asset, and served
  manifest through both `createStandaloneServer` and `createEmbeddedServer`
  runtime ownership paths.
  - [x] Serve the same verified entry document and root-relative executable
    asset request shape through direct Local and committed/embedded launch
    paths, without exposing filesystem fallback. Covered by
    `apps/terminay-server/test/local-ui-server.test.mjs` and
    `apps/terminay-server/test/committed-bundle-ui.test.mjs`.
- [x] Ensure old bundle caches are pruned only after successful replacement. `UiBundleStore` removes superseded content-addressed bundle directories only after atomically replacing `current.json`; failed verification retains the prior bundle and pointer, covered by `packages/server-core/test/ui-bundle-store.test.mjs`.

### Parity and visual tests

- [x] Build a feature parity matrix from every canonical feature specification.
  Evidence: `specs/decisions/evidence/task16-feature-parity-matrix.md` maps all
  17 canonical feature specs to shared UI surfaces, current parity status, and
  remaining shared work; `scripts/task16-feature-parity-matrix.test.mjs` fails
  if a feature spec is missing from the matrix.
- [ ] Add visual/E2E proof that compares the actual production Electron and
  web hosts using the same shared component tree and demonstrates wide-web
  visual parity with the Electron workspace shown in the reference
  screenshots. Existing route-marker, overflow, and isolated-fixture coverage
  is necessary but does not prove this acceptance criterion.
  coverage.
  - [x] Verify the shared responsive route-pane keyboard state machine:
    arrow/Home/End navigation auto-activates routes, explicit Enter/Space
    activation is supported, disabled routes are skipped, and unrelated keys
    cannot change a stale roving-focus selection. Evidence:
    `packages/shared-ui/src/components/ResponsiveRoutePane.test.mjs`.
  - [x] Expose disabled shared route tabs as `aria-disabled` while keeping
    them out of the roving tab order and rejecting their activation. Evidence:
    `packages/shared-ui/src/components/ResponsiveRoutePane.mjs` and its direct
    component tests.
  - [x] Add a bounded browser E2E slice for the real shared web shell at wide
    and narrow viewport widths. Evidence:
    `e2e/shared-responsive-shell.spec.ts` loads
    `src/shared/ResponsiveWorkspaceShell.tsx` through a Vite fixture, verifies
    shared route/region markers and in-page shared route presentation, and
    asserts the document, shell, and terminal region do not create horizontal
    page overflow at 1280px and 390px widths.
  - [x] Verify every registered shared web route at wide and narrow widths.
    The real shared-shell Vite fixture selects workspace, connections, settings,
    recordings, macros, file, and Git routes; each exposes its registered
    semantic regions, remains in-page, and has no document, shell, or terminal
    horizontal overflow. Evidence: `e2e/shared-responsive-shell.spec.ts`.
  - [x] Verify the Desktop and browser host adapters resolve every registered
    route to the identical frozen shared component/region contract. Terminal,
    file, folder, Git, agent, and settings regions cannot drift between hosts;
    only the native-auxiliary versus in-page presentation policy may differ.
    Evidence: `scripts/task16-desktop-web-route-parity.test.mjs`.
  - [x] Exercise the real production Desktop renderer from its immutable
    generated artifact at 1280px, 900px, and compact 640px viewport widths.
    all seven registered routes retain the complete route
    registry, expose their exact shared route identity and Desktop adapter
    presentation (Workspace in-page; Settings, Macros, Recordings, and File
    native-auxiliary; Connections in-page; Git native-auxiliary), stay within
    the viewport, and emit 30 per-view screenshots including the live
    server-backed Agents, project-scoped Folder, and project-scoped Terminal
    auxiliary bodies.
    Connections and Git use
    real shared production bodies with bounded loading, empty, unavailable,
    failed, and ready/status states. Connections additionally consumes
    `ConnectionProfileStore` for select, add/import, rename, distinct confirmed
    forget/revoke actions, capability-gated exposure, and credential-free
    pairing handoff. The Web manager uses that same body with
    `WebConnectionHost`; `e2e/web-connections-multitab.spec.ts` proves
    exact-origin persistence, two-tab storage-event convergence, and that
    pairing fragments never enter localStorage. Git additionally lists worktrees and
    exposes Pull, confirmation-gated removal, reviewed Quick Push
    proposal/approval, and host-capability-gated native terminal actions
    through `TerminayGitClient`; Agents consumes the authenticated
    `AgentStatusClient` projection with loading, unavailable, empty, active,
    needs-input, and failure handling; Folder consumes `FileViewerClient` with
    loading, unavailable, empty, failed, truncated, and ready catalog states
    scoped to the current server-owned project; Terminal lists and creates
    sessions through `TerminayTerminalClient` and uses
    `TerminayTerminalPanelClient` for attach, bounded replay/output, input,
    resize, and detach, with loading, unavailable, empty, failed, and ready
    states. Evidence:
    `e2e/desktop-shared-route-visual.spec.ts` and
    `e2e/shared-production-routes.spec.ts`. The parent remains open while
    canonical feature bodies still use legacy fallbacks.
  - [x] Verify every registered shared web route at the medium responsive
    width. The same real shared-shell fixture selects every route at 900px,
    asserts the shared `medium` layout contract and semantic regions, and
    rejects document, shell, or terminal horizontal overflow. Evidence:
    `e2e/shared-responsive-shell.spec.ts`.
  - [x] Verify live portrait-to-landscape reflow for the real shared web shell.
    The selected route remains in-page while the same browser changes from a
    390px narrow viewport to an 844px medium viewport, retaining its registered
    semantic regions and producing no document, shell, or terminal horizontal
    overflow. Evidence: `e2e/shared-responsive-shell.spec.ts`.
  - [x] Render the shared route rail through the renderer-neutral roving
    tablist contract at wide, medium, and narrow widths. Arrow navigation
    automatically selects an enabled route, moves real DOM focus, preserves
    44px targets, and changes only orientation at the narrow breakpoint.
    Evidence: `createResponsiveRouteTabListModel` in
    `packages/responsive-ui/src/index.ts`, `src/shared/ResponsiveWorkspaceShell.tsx`,
    and `e2e/shared-responsive-shell.spec.ts`.
  - [x] Render the immutable host-neutral accessibility preference policy
    through the real shared shell. Reduced motion disables shell
    animation/transition timing without changing keyboard route access;
    forced-colors and explicit colour-scheme preferences remain declarative
    host inputs, at medium browser width without horizontal overflow. Evidence:
    `packages/responsive-ui/src/index.ts`,
    `src/shared/ResponsiveWorkspaceShell.tsx`, and
    `e2e/shared-responsive-shell.spec.ts`.
  - [x] Render one host-neutral keyboard skip link from shared shell chrome to
    the active route's canonical tabpanel at wide, medium, and narrow browser
    widths. The skip destination is the registered shared route surface—not a
    host-owned feature body—and remains a 44px visible-on-focus control without
    horizontal overflow. Evidence: `src/shared/ResponsiveWorkspaceShell.tsx`,
    `src/shared/ResponsiveWorkspaceShell.css`, and
    `e2e/shared-responsive-shell.spec.ts`.
  - [x] Verify terminal, file, Git, agent, macro, recording, settings, and
    connection failure contracts at the 900px medium viewport. Every shared
    panel retains the canonical wide density (there is no unsupported third
    panel layout), preserves its semantic state and 44px actions, and produces
    no horizontal page overflow. Evidence:
    `e2e/shared-panel-contract-states.spec.ts`.
- [x] Verify terminal, file, Git, agent, macro, recording, settings, and
  connection error states at narrow and wide widths.
  - [x] Render a complete shared route model through one host-neutral React
    surface at wide and narrow browser widths. The surface preserves the
    composer’s canonical panel order, emits one immutable panel-scoped intent,
    and neither imports nor selects a server, transport, or native host.
    Evidence: `src/shared/SharedWorkspaceRouteSurface.tsx` and
    `e2e/shared-workspace-route-surface.spec.ts`.
  - [x] Verify the shared terminal recovery and agent-selection actions forward
    exactly one immutable panel-scoped intent through the host-neutral React
    surface at wide and narrow browser widths. The proof uses only an in-memory
    intent sink: the surface neither imports nor invokes a host, client, or
    transport. Evidence: `e2e/shared-panel-contract-states.spec.ts`.
  - [x] Render the shared renderer-neutral terminal, file, Git, agent, macro,
    recording, settings, and connection failure contracts through one shared
    semantic React surface at wide and narrow browser widths. The surface owns
    only the supplied immutable model's ARIA status/alert/list semantics and
    44px intents; host/client/transport translation remains outside it.
    Evidence: `src/shared/SharedPanelContractSurface.tsx` and
    `e2e/shared-panel-contract-states.spec.ts`.
  - [x] Verify the shared renderer-neutral failure-state contracts for terminal,
    file, Git, agent, macro, recording, settings, and connection surfaces at
    both wide and narrow widths. The matrix preserves each surface's status
    announcement semantics and 44px recovery or selection intent without a
    host or transport dependency. Evidence:
    `packages/shared-ui/src/components/SharedErrorStateMatrix.test.mjs`.
  - [x] Define one shared, renderer-neutral workspace activity indicator for
    wide and narrow tab/header/sidebar presentation. It consumes bounded
    server-owned tab/project activity, derives unread and needs-input counts
    without inventing state, preserves polite status semantics, and exposes a
    44px tab-selection intent without importing an activity client, host, or
    transport. Evidence:
    `packages/shared-ui/src/components/ActivityIndicatorPanel.mjs` and its
    direct component tests.
  - [x] Define one shared, renderer-neutral MCP server control panel for wide
    and narrow hosts. It distinguishes loading, ready, empty, unavailable, and
    retryable failure state; bounds server identities and display metadata;
    exposes only exact start/stop/retry server intents with 44px targets; and
    imports no MCP client, host, installation, process, or transport API.
    Evidence: `packages/shared-ui/src/components/McpServerControlPanel.mjs` and
    its direct component tests.
  - [x] Define one shared, renderer-neutral activity-notification panel for
    wide and narrow hosts. It consumes only bounded server activity entries,
    derives unread count from canonical acknowledgement state, distinguishes
    needs-input/completed/failed/fallback activity without inventing state, and
    emits one immutable project/session-scoped focus-and-acknowledge intent per
    item with a 44px target. Evidence:
    `packages/shared-ui/src/components/ActivityNotificationPanel.mjs` and its
    direct component tests.
  - [x] Define one shared, renderer-neutral AI tab-metadata state panel for
    wide and narrow hosts. It distinguishes loading, ready, unavailable,
    retryable failed, and disabled state; bounds generated title/icon/colour
    metadata; preserves accessible status semantics; and exposes a 44px
    regeneration intent only for retryable failures without importing an AI
    provider, credentials, host, or transport. Evidence:
    `packages/shared-ui/src/components/AiTabMetadataPanel.mjs` and its direct
    component tests.
  - [x] Define one shared, renderer-neutral dictation capture overlay for wide
    and narrow hosts. It binds display state to one immutable server/project/
    panel/session target; distinguishes permission, recording, transcribing,
    inserting, completion, cancellation, and sanitized error states; discloses
    the selected server/provider destination without carrying audio or
    credentials; and only permits a new capture after failure, never retrying
    discarded audio. Evidence:
    `packages/shared-ui/src/components/DictationCapturePanel.mjs` and its
    direct component tests.
  - [x] Define one shared renderer-neutral Git status panel for wide and narrow
    hosts. It distinguishes loading, clean, changes, conflicts, unavailable,
    and retryable failures; exposes safe bounded repository metadata; and
    exposes 44px Git/retry intents without importing a Git client, host, or
    transport. Evidence: `packages/shared-ui/src/components/GitStatusPanel.mjs`
    and its direct component tests.
  - [x] Define one shared, renderer-neutral Quick Push review panel for wide
    and narrow hosts. It distinguishes loading, ready, empty, unavailable, and
    retryable failed state; bounds project, branch, and commit review metadata;
    exposes accessible commit-list semantics; and supplies 44px push, copy, and
    retry intents without importing a Git client, clipboard, host, or
    transport. Evidence:
    `packages/shared-ui/src/components/QuickPushReviewPanel.mjs` and its direct
    component tests.
  - [x] Define one shared, renderer-neutral terminal attachment state panel for
    wide and narrow hosts. It distinguishes connecting, attached, reconnecting,
    disconnected, failed, and closed state; keeps terminal output out of live
    announcements; and exposes a 44px retry intent only for retryable failures
    without importing a client, host, or transport. Evidence:
    `packages/shared-ui/src/components/TerminalSessionPanel.mjs` and its direct
    component tests.
  - [x] Define one shared renderer-neutral agent activity state panel for wide
    and narrow hosts. It bounds agent identities and display text, distinguishes
    working, waiting, needs-input, completed, failed, and idle state, preserves
    the selected agent through accessible list semantics, and exposes 44px
    selection intents without importing a host or transport. Evidence:
    `packages/shared-ui/src/components/AgentStatusPanel.mjs` and its direct
    component tests.
  - [x] Define one shared renderer-neutral file-viewer state panel for wide
    and narrow hosts. It distinguishes loading, ready, unavailable, forbidden,
    failed, and deleted states; preserves safe file metadata; keeps file
    content out of live announcements; and exposes a 44px retry intent only
    for retryable failures without importing a host or transport. Evidence:
    `packages/shared-ui/src/components/FileViewerPanel.mjs` and its direct
    component tests.
  - [x] Define one shared, renderer-neutral connection-error panel for wide and
    narrow hosts. It distinguishes retryable transport failures from expired,
    revoked, and identity-mismatch credentials; exposes an atomic assertive
    alert and 44px recovery actions without importing a concrete transport.
    Evidence: `packages/shared-ui/src/components/ConnectionErrorPanel.mjs` and
    `packages/shared-ui/src/components/ConnectionErrorPanel.test.mjs`.
  - [x] Define one shared, renderer-neutral macro-library state panel for wide
    and narrow hosts. It distinguishes loading, ready, empty, unavailable, and
    retryable failed state; bounds macro identities and display text; preserves
    the selected macro through accessible list semantics; and exposes 44px
    selection/retry intents without importing macro storage, a host, or a
    transport. Evidence: `packages/shared-ui/src/components/MacroLibraryPanel.mjs`
    and its direct component tests.
  - [x] Define one shared, renderer-neutral recordings-library state panel for
    wide and narrow hosts. It distinguishes loading, ready, empty, unavailable,
    and retryable failed state; bounds recording identities and display text;
    preserves the selected recording through accessible list semantics; and
    exposes 44px selection/retry intents without importing recording storage, a
    host, or a transport. Evidence:
    `packages/shared-ui/src/components/RecordingsLibraryPanel.mjs` and its
    direct component tests.
  - [x] Define one shared, renderer-neutral settings state panel for wide and
    narrow hosts. It distinguishes loading, ready, unavailable, forbidden, and
    retryable failed state; bounds settings-section identities and display text;
    preserves the selected section through accessible tab semantics; and
    exposes 44px section/retry intents without importing settings persistence,
    a host, or a transport. Evidence:
    `packages/shared-ui/src/components/SettingsPanel.mjs` and its direct
    component tests.
- [x] Ensure one feature fix changes one shared implementation.
  - [x] Mechanically enforce the renderer-neutral package boundary for every
    shared feature component: component source may import only local shared UI
    modules and may not reach Electron, IPC, browser transport, Node process,
    or host globals. Evidence:
    `packages/shared-ui/src/components/SharedUiBoundary.test.mjs`.

## Acceptance checks

- There is one production workspace UI implementation and one client state
  library.
- The server bundle provides current desktop feature parity in a wide browser.
- A narrow mobile browser can navigate projects/views/panels and safely operate
  terminals without horizontal page overflow.
- Desktop native routes use the same components as web routes.
- No shared UI package imports Electron, Node, WebRTC, or a concrete local
  transport.

## Definition of done

Desktop and browser are hosts for the same complete responsive server-bundled
workspace, and the old terminal-only remote UI is removed after verified parity.
