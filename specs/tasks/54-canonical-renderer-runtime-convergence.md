# Canonical renderer runtime convergence

## Goal

Finish the server-bundled renderer cutover so development, packaged Desktop,
signed releases, direct browser sessions, and the browser manager execute one
workspace architecture. Delete the superseded Electron workspace renderer and
its compatibility adapters rather than preserving two products behind runtime
branches.

## Governing contracts

- [Server-bundled clients and protocol-blind hosts](../decisions/server-bundled-client-hosts.md)
- [Connections and client hosts](../features/connections-and-client-hosts.md)
- [Terminay server runtime and application protocol](../features/server-runtime-and-protocol.md)
- [Server-owned workspace state](../features/server-owned-workspace-state.md)
- [Settings, shortcuts, and desktop integration](../features/settings-shortcuts-and-desktop-integration.md)
- [Terminal workspace](../features/terminal-workspace.md)
- [File explorer and folder tabs](../features/file-explorer-and-folder-tabs.md)
- [File viewer](../features/file-viewer.md)
- [Terminal recording](../features/recording.md)
- [Local Desktop diagnostics](../features/local-desktop-diagnostics.md)

## Current drift

The accepted architecture says a selected Terminay Server supplies the only
full workspace renderer and its matching application client. The repository
still has two live normal-workspace startup graphs:

- development selects `index.html`, the broad Electron preload, and the
  installed renderer bootstrap when `VITE_DEV_SERVER_URL` is present; and
- packaged Desktop selects the verified `server.html` bundle, canonical host
  bridge, and opaque byte endpoint.

Consequently development and release exercise different state hydration,
menu, preload, lifecycle, and connection code. Packaged startup can connect
successfully to an empty in-memory workspace because its path does not perform
the renderer-owned development seed. The sidebar then has no authoritative
project scope and reports `query failed`. The packaged host also reads a
`WebContents.session` after that `WebContents` is destroyed, producing an
uncaught main-process exception on close.

Existing smoke coverage masks the empty-start defect by clicking a create
project action when no terminal exists. Focused contract/static tests prove
individual bundle and transport boundaries but do not prove the released
artifact's complete startup, restoration, sidebar, menu, and shutdown journey.

## Required implementation

### 1. One workspace execution graph

- [ ] Make development Local, packaged Local, signed Local, Desktop remote,
  direct browser, and browser-manager sessions launch the same generated
  server workspace entry and matching application client.
- [x] Make the development watcher rebuild/serve that canonical Local server
  bundle without selecting a different renderer entry, preload, connection
  facade, state owner, or route tree.
- [x] Remove environment/build-mode branching that chooses between a complete
  Electron renderer and the server-bundled renderer. Environment values may
  select asset locations and diagnostics only.
- [x] Ensure main workspace and auxiliary routes obtain the selected server,
  host context, and application byte endpoint through the same canonical
  composition in development and packaged builds.
- [ ] Replace browser user-agent/runtime-brand startup gates with an explicit
  capability negotiation for direct-browser and manager bootstrap. Bundle
  acceptance must use protocol/schema revisions and required capabilities, not
  Chromium/browser-version ranges.

### 2. Delete the superseded renderer architecture

- [x] Delete the old full-workspace Electron HTML/TypeScript entry and its
  renderer bootstrap after every production responsibility is represented by
  the server bundle or the narrow host shell.
- [x] Delete the broad workspace preload/MessagePort bootstrap and retain only
  closed, source-bound host capabilities plus the opaque application byte
  endpoint.
- [x] Delete live Desktop feature-compatibility adapters for terminals, files,
  recordings, macros, settings, workspace seeding, and server-frame ownership;
  shared components must call the selected server's bundled client directly.
- [x] Delete the legacy Electron AI-metadata and dictation adapters, renderer
  fallbacks, and global declarations. Model discovery, credentials, runtime
  management, and transcription use the selected-server client; microphone
  capture uses the browser media capability without gaining provider authority.
- [x] Delete duplicate renderer state stores, feature DTO projections, fallback
  route bodies, and conditionals whose only purpose is to keep the superseded
  workspace path executable.
- [x] Add a static production-graph gate that fails if a second full workspace
  entry, broad preload, renderer-owned workspace seed, or feature-aware Desktop
  transport adapter is introduced.

This task does not preserve backwards compatibility with the superseded
Electron renderer architecture or import its client-owned workspace state.
Current canonical server repository schema migrations remain allowed because
they are server persistence, not a second renderer.

The remaining `legacy` names are classified narrowly:

- `apps/terminay-web/src/legacyMigration.ts` and its web entry callers import
  persisted browser connection-manager records once, then delete the source;
- server-core migration inventory/runner/types, workspace/settings/shell
  normalization, macro/terminal settings, and recording import code read
  persisted older schemas into the canonical server-owned schema;
- `legacyNodeDataChannelFallback: false` is a fail-closed runtime-selection
  assertion, not an executable fallback.
- `electron/remote/deployedTerminalProtocol.ts` is the deployed v1 remote wire
  parser used by the privileged WebRTC service; it cannot load a renderer,
  preload, workspace projection, or client-owned authority.

Adapter recovery inventories that report deleted renderer preloads, terminal-
only remote clients, or feature preloads as `retain-until-parity` are forbidden.
They keep the removed architecture conceptually live and cannot be used for
persisted-data recovery.

### 3. Canonical server persistence and first launch

- [x] Compose the same durable `WorkspaceRepository` and transaction boundary
  into embedded and standalone server startup; a bare in-memory `WorkspaceStore`
  is not a production authority.
- [x] On a genuinely new data root, atomically create one workspace view, one
  This server project, one terminal panel, and its terminal session before the
  server reports the workspace ready.
- [x] Make first-run initialization idempotent across concurrent clients,
  renderer reload, additional windows, embedded-server restart, and process
  restart.
- [x] Restore an existing repository without manufacturing another project or
  retaining unusable Local terminal tabs. A Local Desktop server restart removes
  stale terminal panels/sessions and creates exactly one fresh active terminal;
  a still-running remote server retains its live terminal sessions across
  reconnect.
- [x] Fail startup/recovery with a bounded actionable state when canonical
  persistence cannot be read or committed. A renderer must never repair it by
  creating local identities.

### 4. Host-specific menu and native chrome

- [x] Drive menu presentation solely from the negotiated native-menu host
  capability: Desktop uses the native application menu, while browser hosts
  render the in-page File/Edit/View/Help menu.
- [x] Ensure the server bundle renders no browser menu bar in Electron,
  including development mode, packaged mode, Local, remote, reload, and
  auxiliary routes.
- [x] Reserve the native macOS title-bar and traffic-light inset before placing
  project tabs and controls; no shared control may overlap native chrome.
- [x] Keep browser command availability and keyboard behaviour equivalent
  without exposing Desktop-only window/update/DevTools commands.

### 5. Complete initial workspace hydration

- [x] Do not present a connected workspace as ready until the initial or
  restored snapshot has a valid active view/project/panel projection or an
  explicit empty-state contract.
- [x] A fresh normal Local launch must show the initial project, active terminal
  tab, live shell, and enabled sidebar without a user-created repair action.
- [x] Project/terminal creation reconciles from the authoritative command
  result and revision exactly once; it cannot race initialization into
  duplicate default projects or sessions.
- [ ] Reloading a window reconstructs the same project, panel, session,
  selected server, and logical view from server state. Reopening Local after
  its server stops restores the workspace without stale terminal tabs and
  starts one fresh terminal; reconnecting to a live remote server retains its
  live terminal sessions.

### 6. Sidebar and feature-query authority

- [x] Route Explorer, Agents, Git, files, recordings, macros, settings, and
  related sidebar queries through the canonical selected-server client with
  the active server/project/environment identity from the hydrated snapshot.
- [x] Remove host-local query facades and generic `query failed` collapse paths
  that hide operation, scope, repository, or transport failures.
- [x] Keep the sidebar disabled only for a typed unavailable state. A valid
  active project enables it, and failures display bounded actionable copy
  without losing the terminal workspace.
- [x] Prove creating a second project or terminal does not change the authority
  used by the sidebar and does not require a reload.

### 7. Lifecycle correctness

- [ ] Capture every required `WebContents`, `session`, id, partition, and
  listener handle before registering destruction callbacks; never dereference
  a destroyed Electron object.
- [ ] Make window close, reload, server switch, application quit, failed bundle
  launch, and superseded transport teardown idempotent and exception-free.
- [x] Preserve server/project/session lifetime independently of a renderer
  document while releasing document-scoped ports, subscriptions, downloads,
  and host bindings exactly once.
- [x] Convert bootstrap and teardown failures into bounded diagnostics/recovery
  UI rather than an uncaught Electron main-process dialog or blank window.
- [ ] Render a typed, visible direct-browser bootstrap failure that identifies
  each missing required capability or failed bootstrap step; no incompatible,
  reduced, or spoofed user agent may cause a blank document or top-level
  uncaught throw.

### 8. Replace misleading test coverage

- [x] Run the canonical server-bundle entry in normal development E2E; tests
  must not exercise a deleted development-only workspace renderer.
- [x] Add a dev-versus-packaged parity test that starts both from equivalent
  canonical server repositories and compares bundle identity, host capability
  projection, workspace revision, projects, panels, sessions, menu mode, and
  sidebar readiness.
- [x] Add fresh-data-root, populated-data-root, reload, restart, multi-window,
  and remote-profile fixtures against the same startup composition.
- [x] Assert that a fresh startup already contains a live terminal and working
  sidebar. The harness must not click New Project/New Terminal to repair a
  missing initial state before making its readiness assertion.
- [x] Add focused Explorer/query coverage that fails on an unscoped or
  host-local request and requires actionable rendering for a real failure.
- [x] Add clean-close/reload/quit coverage that treats any main-process
  exception, `Object has been destroyed`, unexpected dialog, renderer crash,
  or unresolved listener as a test failure.
- [x] Remove or rewrite tests whose success depends on the superseded entry,
  preload, seed adapter, feature transport, or fallback route.
- [ ] Add direct-browser compatibility coverage for Firefox, Chromium, and
  reduced/spoofed user-agent strings with the same required capabilities, plus
  a typed visible failure assertion for genuinely missing capabilities.

### 9. Release artifact gate

- [x] Make the release smoke install/extract and launch the actual packaged
  artifact produced by that workflow, with its packaged resources and canonical
  preload, rather than a development server or synthetic loose build.
- [x] Require visible project and terminal readiness, successful sidebar query,
  Desktop-native/browser-menu absence, terminal input/output, reload
  restoration, and clean shutdown from a clean data root.
- [x] Run the same smoke with a pre-populated canonical repository and require
  restoration without duplicate seed state.
- [x] Forbid smoke-test self-healing: no readiness helper may create a project,
  terminal, or workspace when the expected restored/initialized state is
  absent.
- [x] Preserve startup, renderer, server, and shutdown diagnostics as release
  artifacts on failure and fail the release before publication.

## Acceptance checks

1. `npm run dev` and the packaged application report the same generated Local
   bundle id and use the same workspace entry, host bridge, byte endpoint,
   repository hydration, and React feature tree.
2. Source/build graph inspection finds one full workspace entry and no live
   Electron-only renderer, broad workspace preload, renderer seed adapter, or
   feature-aware Desktop application transport.
3. On macOS Desktop there is one native File/Edit/View/Help menu, no in-page
   application menu, and no overlap between traffic lights and workspace
   controls. The browser has the equivalent in-page menu.
4. A clean data root opens with one This server project, one active terminal,
   a working shell, and an enabled/queryable sidebar without test or user
   intervention.
5. Client reload does not kill a live PTY or change its identity. A Local
   server restart restores canonical projects/non-terminal panels, drops its
   dead terminal tabs, and starts exactly one fresh terminal without duplicate
   project state; a live remote server retains its terminal sessions.
6. Creating projects/terminals leaves Explorer and other feature queries bound
   to the correct selected server/project and never produces an unexplained
   `query failed` banner.
7. Closing, reloading, switching, and quitting emit no uncaught Electron error
   and release each document-scoped resource once.
8. Docker E2E exercises the canonical development and packaged paths. The
   signed-release smoke exercises the exact release artifact and cannot repair
   missing startup state.

## Definition of done

- Every implementation checkbox above is complete with direct code or
  deterministic automated evidence.
- The old renderer/bootstrap/adapters are deleted, not renamed, disabled, or
  retained behind a flag.
- Development, packaged Desktop, and release artifacts use the canonical
  server-bundled path by construction.
- Focused unit/integration suites, `npm run test:e2e`, packaged artifact smoke,
  and release gates pass without a self-healing test helper.
- The task remains active until the deletion inventory, fresh/restored journey,
  menu parity, sidebar queries, and clean shutdown are all proven together.
