## Why

The accepted architecture says a selected Terminay Server supplies the only
full workspace renderer and its matching application client, but the repository
still had two live normal-workspace startup graphs: development selected
`index.html`, the broad Electron preload, and the installed renderer bootstrap
when `VITE_DEV_SERVER_URL` was present, while packaged Desktop selected the
verified `server.html` bundle, canonical host bridge, and opaque byte endpoint.
Development and release therefore exercised different state hydration, menu,
preload, lifecycle, and connection code.

## What Changes

- **BREAKING** Make development Local, packaged Local, signed Local, Desktop
  remote, direct browser, and browser-manager sessions launch the same
  generated server workspace entry and matching application client. Environment
  values may select asset locations and diagnostics only.
- **BREAKING** Delete the superseded Electron workspace renderer: its HTML and
  TypeScript entry, renderer bootstrap, broad workspace preload and MessagePort
  bootstrap, Desktop feature-compatibility adapters, legacy AI-metadata and
  dictation adapters, duplicate renderer state stores, and fallback route
  bodies. No compatibility wrappers are retained.
- Replace browser user-agent and runtime-brand startup gates with explicit
  capability negotiation using protocol and schema revisions plus required
  capabilities.
- Compose the same durable `WorkspaceRepository` and transaction boundary into
  embedded and standalone server startup, and atomically create one workspace
  view, one This server project, one terminal panel, and its terminal session
  on a genuinely new data root before reporting the workspace ready.
- Restore an existing repository without manufacturing another project: a Local
  Desktop server restart drops stale terminal panels and starts exactly one
  fresh terminal, while a still-running remote server retains its live terminal
  sessions across reconnect.
- Drive menu presentation solely from the negotiated native-menu capability,
  reserve the native macOS title-bar and traffic-light inset, and render no
  browser menu bar inside Electron.
- Route sidebar feature queries through the canonical selected-server client
  with the hydrated active identity, and remove host-local query facades and
  generic `query failed` collapse paths.
- Capture every required Electron handle before registering destruction
  callbacks so close, reload, server switch, and quit are idempotent and
  exception-free.
- Add a static production-graph gate that fails if a second full workspace
  entry, broad preload, renderer-owned workspace seed, or feature-aware Desktop
  transport adapter is reintroduced.
- Replace misleading test coverage, including smoke helpers that repaired
  missing startup state, and make the release smoke launch the actual packaged
  artifact.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `connections-and-client-hosts`: one workspace execution graph across
  development and packaged Desktop, per-host menu and native chrome, and
  lifecycle correctness.
- `server-owned-workspace-state`: canonical persistence in both server modes,
  first-run initialization, repository restoration, and typed sidebar feature
  query state.
- `server-runtime-and-protocol`: capability-negotiated browser gating in place
  of user-agent gates, and typed bootstrap failure reporting.

## Impact

The Electron main process and preload, the development watcher, the generated
server workspace entry, embedded and standalone server startup composition,
`WorkspaceRepository` wiring, sidebar feature clients, the Electron native menu
and macOS chrome insets, the E2E suites, the packaged artifact smoke, and the
release gate. The deletion inventory removes the second renderer entirely
rather than disabling it.
