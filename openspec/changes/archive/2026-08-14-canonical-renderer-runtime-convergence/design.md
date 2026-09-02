## Context

See proposal.md. Two live startup graphs had two visible consequences beyond
the drift itself. Packaged startup could connect successfully to an empty
in-memory workspace, because its path did not perform the renderer-owned
development seed; the sidebar then had no authoritative project scope and
reported `query failed`. Separately, the packaged host read a
`WebContents.session` after that `WebContents` had been destroyed, producing an
uncaught main-process exception on close.

Existing smoke coverage masked the empty-start defect by clicking a create
project action when no terminal existed. Focused contract and static tests
proved individual bundle and transport boundaries but did not prove the
released artifact's complete startup, restoration, sidebar, menu, and shutdown
journey.

## Goals / Non-Goals

Goals:
- One workspace execution graph by construction, not by convention.
- Canonical durable server persistence as the only production authority.
- A fresh Local launch that is usable without a user or test repair action.
- Clean, exception-free lifecycle for close, reload, switch, and quit.

Non-Goals:
- Backwards compatibility with the superseded Electron renderer architecture,
  or importing its client-owned workspace state.

## Decisions

### One execution graph, environment selects assets only

Development, packaged, and signed Local, Desktop remote, direct browser, and
browser-manager sessions all launch the same generated server workspace entry
and matching application client. The development watcher rebuilds and serves
that canonical Local server bundle rather than selecting a different renderer
entry, preload, connection facade, state owner, or route tree. Environment and
build-mode branching that chose between a complete Electron renderer and the
server-bundled renderer was removed; environment values may still select asset
locations and diagnostics.

A static production-graph gate fails the build if a second full workspace
entry, a broad preload, a renderer-owned workspace seed, or a feature-aware
Desktop transport adapter is introduced.

### Delete, do not retain

The superseded renderer, its bootstrap, and its adapters were deleted rather
than renamed, disabled, or flagged. Adapter recovery inventories that report
deleted renderer preloads, terminal-only remote clients, or feature preloads as
`retain-until-parity` are forbidden: they keep the removed architecture
conceptually live and cannot be used for persisted-data recovery.

The remaining `legacy` names were classified narrowly and deliberately kept:

- `apps/terminay-web/src/legacyMigration.ts` and its web entry callers import
  persisted browser connection-manager records once, then delete the source;
- server-core migration inventory, runner and types, workspace, settings and
  shell normalization, macro and terminal settings, and recording import code
  read persisted older schemas into the canonical server-owned schema;
- `legacyNodeDataChannelFallback: false` is a fail-closed runtime-selection
  assertion, not an executable fallback;
- `electron/remote/deployedTerminalProtocol.ts` is the deployed v1 remote wire
  parser used by the privileged WebRTC service and cannot load a renderer,
  preload, workspace projection, or client-owned authority.

Current canonical server repository schema migrations remain allowed because
they are server persistence, not a second renderer.

### Capability negotiation replaces user-agent gates

Direct-browser and manager bootstrap negotiate explicit capabilities. Bundle
acceptance uses protocol and schema revisions and required capabilities, not
Chromium or browser-version ranges. A reduced or spoofed user agent must not
cause a blank document or a top-level uncaught throw; a genuinely missing
capability produces a typed, visible failure naming each missing requirement or
failed bootstrap step.

### Canonical persistence and first launch

The same durable `WorkspaceRepository` and transaction boundary compose into
embedded and standalone startup; a bare in-memory `WorkspaceStore` is not a
production authority. On a genuinely new data root, one workspace view, one
This server project, one terminal panel, and its terminal session are created
atomically before the server reports the workspace ready. Initialization is
idempotent across concurrent clients, renderer reload, additional windows,
embedded-server restart, and process restart.

Restoration distinguishes the two cases deliberately: a Local Desktop server
restart removes stale terminal panels and sessions and creates exactly one
fresh active terminal, whereas a still-running remote server retains its live
terminal sessions across reconnect. When canonical persistence cannot be read
or committed, startup fails with a bounded actionable state; a renderer must
never repair it by creating local identities.

### Menu and native chrome per host

Menu presentation is driven solely by the negotiated native-menu capability:
Desktop uses the native application menu and the server bundle renders no
browser menu bar in Electron, including development mode, packaged mode, Local,
remote, reload, and auxiliary routes. The native macOS title-bar and
traffic-light inset is reserved before project tabs and controls are placed.

### Sidebar authority

Explorer, Agents, Git, files, recordings, macros, settings, and related sidebar
queries route through the canonical selected-server client using the active
server, project, and environment identity from the hydrated snapshot.
Host-local query facades and generic `query failed` collapse paths that hid
operation, scope, repository, or transport failures were removed. The sidebar
is disabled only for a typed unavailable state.

### Lifecycle correctness

Every required `WebContents`, `session`, id, partition, and listener handle is
captured before destruction callbacks are registered, so no destroyed Electron
object is dereferenced. Window close, reload, server switch, application quit,
failed bundle launch, and superseded transport teardown are idempotent and
exception-free, and server, project, and session lifetime is independent of a
renderer document while document-scoped ports, subscriptions, downloads, and
host bindings release exactly once.

## Risks / Trade-offs

- Deleting the second renderer removes any fallback if the server bundle path
  regresses. This is accepted deliberately: two products behind runtime
  branches was the defect. The mitigation is the static production-graph gate
  plus dev-versus-packaged parity coverage.
- Dropping stale Local terminal tabs on server restart loses those tabs. It is
  preferred to presenting terminal tabs whose sessions cannot exist.
- Forbidding self-healing test helpers makes the suite stricter and will fail
  loudly on a genuine startup regression, which is the point.

## Migration Plan

No compatibility with the superseded renderer is preserved and its client-owned
workspace state is not imported. Server-side schema migrations continue to read
persisted older schemas into the canonical server-owned schema. Browser
connection-manager records are imported once by the web entry and the source is
then deleted.
