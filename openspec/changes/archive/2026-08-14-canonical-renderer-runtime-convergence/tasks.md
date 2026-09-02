## 1. One workspace execution graph

- [x] 1.1 Make development Local, packaged Local, signed Local, Desktop remote, direct browser, and browser-manager sessions launch the same generated server workspace entry and matching application client, verified by the dev-versus-packaged parity test comparing bundle identity
- [x] 1.2 Make the development watcher rebuild and serve that canonical Local server bundle without selecting a different renderer entry, preload, connection facade, state owner, or route tree, verified by the development E2E running the canonical entry
- [x] 1.3 Remove environment and build-mode branching that chooses between a complete Electron renderer and the server-bundled renderer, leaving environment values to select asset locations and diagnostics only, verified by the static production-graph gate
- [x] 1.4 Ensure main workspace and auxiliary routes obtain the selected server, host context, and application byte endpoint through the same canonical composition in development and packaged builds, verified by the parity test's host capability projection comparison
- [x] 1.5 Replace browser user-agent and runtime-brand startup gates with explicit capability negotiation using protocol and schema revisions and required capabilities, verified by the reduced and spoofed user-agent compatibility coverage

## 2. Delete the superseded renderer architecture

- [x] 2.1 Delete the old full-workspace Electron HTML and TypeScript entry and its renderer bootstrap, verified by the static production-graph gate finding one full workspace entry
- [x] 2.2 Delete the broad workspace preload and MessagePort bootstrap, retaining only closed source-bound host capabilities and the opaque application byte endpoint, verified by the static gate and the host bridge contract tests
- [x] 2.3 Delete live Desktop feature-compatibility adapters for terminals, files, recordings, macros, settings, workspace seeding, and server-frame ownership so shared components call the selected server's bundled client directly, verified by the static gate
- [x] 2.4 Delete the legacy Electron AI-metadata and dictation adapters, renderer fallbacks, and global declarations, routing model discovery, credentials, runtime management, and transcription through the selected-server client while microphone capture uses the browser media capability, verified by the static gate and focused AI/dictation tests
- [x] 2.5 Delete duplicate renderer state stores, feature DTO projections, fallback route bodies, and conditionals that existed only to keep the superseded path executable, verified by the static gate
- [x] 2.6 Add a static production-graph gate that fails if a second full workspace entry, broad preload, renderer-owned workspace seed, or feature-aware Desktop transport adapter is introduced, verified by the gate failing against a deliberate reintroduction fixture

## 3. Canonical server persistence and first launch

- [x] 3.1 Compose the same durable `WorkspaceRepository` and transaction boundary into embedded and standalone server startup so a bare in-memory `WorkspaceStore` is not a production authority, verified by the startup composition tests
- [x] 3.2 On a genuinely new data root, atomically create one workspace view, one This server project, one terminal panel, and its terminal session before reporting the workspace ready, verified by the fresh-data-root fixture
- [x] 3.3 Make first-run initialization idempotent across concurrent clients, renderer reload, additional windows, embedded-server restart, and process restart, verified by the concurrent and restart fixtures
- [x] 3.4 Restore an existing repository without manufacturing another project or retaining unusable Local terminal tabs, dropping stale terminal panels and starting exactly one fresh terminal on Local restart while a live remote server retains its terminal sessions, verified by the populated-data-root and remote-profile fixtures
- [x] 3.5 Fail startup and recovery with a bounded actionable state when canonical persistence cannot be read or committed, with no renderer-created local identities, verified by the corrupt-repository fixture

## 4. Host-specific menu and native chrome

- [x] 4.1 Drive menu presentation solely from the negotiated native-menu host capability, with Desktop using the native application menu and browser hosts rendering the in-page File/Edit/View/Help menu, verified by the menu mode assertions in the parity test
- [x] 4.2 Ensure the server bundle renders no browser menu bar in Electron in development, packaged, Local, remote, reload, and auxiliary routes, verified by the Electron menu absence assertions
- [x] 4.3 Reserve the native macOS title-bar and traffic-light inset before placing project tabs and controls so no shared control overlaps native chrome, verified by the macOS chrome inset assertions
- [x] 4.4 Keep browser command availability and keyboard behaviour equivalent without exposing Desktop-only window, update, or DevTools commands, verified by the browser menu model tests

## 5. Complete initial workspace hydration

- [x] 5.1 Do not present a connected workspace as ready until the initial or restored snapshot has a valid active view, project, and panel projection or an explicit empty-state contract, verified by the readiness assertions
- [x] 5.2 Ensure a fresh normal Local launch shows the initial project, active terminal tab, live shell, and enabled sidebar without a user-created repair action, verified by the fresh-data-root E2E readiness assertion
- [x] 5.3 Reconcile project and terminal creation from the authoritative command result and revision exactly once so it cannot race initialization into duplicate default projects or sessions, verified by the creation reconciliation tests
- [x] 5.4 Ensure reloading a window reconstructs the same project, panel, session, selected server, and logical view from server state, with Local reopen after a server stop restoring the workspace without stale terminal tabs and a live remote reconnect retaining its sessions, verified by the reload and restart fixtures

## 6. Sidebar and feature-query authority

- [x] 6.1 Route Explorer, Agents, Git, files, recordings, macros, settings, and related sidebar queries through the canonical selected-server client with the active server, project, and environment identity from the hydrated snapshot, verified by the focused Explorer and query coverage
- [x] 6.2 Remove host-local query facades and generic `query failed` collapse paths that hid operation, scope, repository, or transport failures, verified by tests that fail on an unscoped or host-local request
- [x] 6.3 Keep the sidebar disabled only for a typed unavailable state, enabling it for a valid active project and displaying bounded actionable copy on failure without losing the terminal workspace, verified by the sidebar state tests
- [x] 6.4 Prove creating a second project or terminal does not change the authority used by the sidebar and does not require a reload, verified by the multi-project query coverage

## 7. Lifecycle correctness

- [x] 7.1 Capture every required `WebContents`, `session`, id, partition, and listener handle before registering destruction callbacks so no destroyed Electron object is dereferenced, verified by the clean-close coverage treating `Object has been destroyed` as a failure
- [x] 7.2 Make window close, reload, server switch, application quit, failed bundle launch, and superseded transport teardown idempotent and exception-free, verified by the lifecycle coverage
- [x] 7.3 Preserve server, project, and session lifetime independently of a renderer document while releasing document-scoped ports, subscriptions, downloads, and host bindings exactly once, verified by the teardown tests
- [x] 7.4 Convert bootstrap and teardown failures into bounded diagnostics and recovery UI rather than an uncaught Electron main-process dialog or blank window, verified by the failure fixtures
- [x] 7.5 Render a typed visible direct-browser bootstrap failure naming each missing required capability or failed bootstrap step, with no blank document or top-level uncaught throw for an incompatible, reduced, or spoofed user agent, verified by the browser compatibility coverage

## 8. Replace misleading test coverage

- [x] 8.1 Run the canonical server-bundle entry in normal development E2E and exercise no deleted development-only workspace renderer, verified by the development E2E suite
- [x] 8.2 Add a dev-versus-packaged parity test comparing bundle identity, host capability projection, workspace revision, projects, panels, sessions, menu mode, and sidebar readiness from equivalent canonical repositories, verified by that test
- [x] 8.3 Add fresh-data-root, populated-data-root, reload, restart, multi-window, and remote-profile fixtures against the same startup composition, verified by those fixtures
- [x] 8.4 Assert that a fresh startup already contains a live terminal and working sidebar without the harness clicking New Project or New Terminal to repair missing state, verified by the readiness assertion
- [x] 8.5 Add focused Explorer and query coverage that fails on an unscoped or host-local request and requires actionable rendering for a real failure, verified by that coverage
- [x] 8.6 Add clean-close, reload, and quit coverage treating any main-process exception, `Object has been destroyed`, unexpected dialog, renderer crash, or unresolved listener as a test failure, verified by that coverage
- [x] 8.7 Remove or rewrite tests whose success depended on the superseded entry, preload, seed adapter, feature transport, or fallback route, verified by the updated suites passing against the canonical path
- [x] 8.8 Add direct-browser compatibility coverage for Firefox, Chromium, and reduced or spoofed user-agent strings with the same required capabilities plus a typed visible failure assertion for genuinely missing capabilities, verified by that coverage

## 9. Release artifact gate

- [x] 9.1 Make the release smoke install, extract, and launch the actual packaged artifact produced by that workflow with its packaged resources and canonical preload, verified by the release smoke run
- [x] 9.2 Require visible project and terminal readiness, successful sidebar query, absence of a browser menu on Desktop, terminal input and output, reload restoration, and clean shutdown from a clean data root, verified by the release smoke assertions
- [x] 9.3 Run the same smoke with a pre-populated canonical repository and require restoration without duplicate seed state, verified by that smoke run
- [x] 9.4 Forbid smoke-test self-healing so no readiness helper creates a project, terminal, or workspace when the expected state is absent, verified by review of the readiness helpers and the failing behaviour on missing state
- [x] 9.5 Preserve startup, renderer, server, and shutdown diagnostics as release artifacts on failure and fail the release before publication, verified by the release workflow
