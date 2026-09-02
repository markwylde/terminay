## Why

Projects, layouts, terminal metadata, active panels, and cross-window movement lived in
the Electron renderer, and PTYs were owned by `webContentsId`, so destroying a renderer
killed live terminal sessions and no fresh client could reconstruct the workspace from
authoritative state.

## What Changes

- Introduce the canonical server workspace-view, project, panel, and terminal-session model
  with stable server-issued ids and explicit ownership relationships.
- Add revisioned, idempotent, scoped workspace commands with snapshot, ordered events,
  expected-revision conflicts, delta, and full-resync behaviour.
- Persist canonical state through a schema-versioned repository with atomic commit,
  backup/recovery, and idempotent migration primitives.
- **BREAKING** Remove PTY ownership from renderer `webContentsId`; renderer subscriptions
  become detachable consumers of server-owned sessions.
- Adapt the existing renderer to a `TerminayClient` workspace API behind a temporary
  Electron IPC transport, preserving current drag, split, rename, close, popout, and
  adoption behaviour.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `server-owned-workspace-state`: the server becomes the sole canonical authority for the
  workspace model, its commands, revisions, and persistence.
- `terminal-workspace`: terminal sessions gain immutable server-issued identity independent
  of any renderer or native window.
- `workspace-and-project-tabs`: project and panel presentation is derived from canonical
  server state rather than renderer-local membership.

## Impact

Server-core workspace model, command handling, and state repository; the shared client
workspace API; the Electron IPC compatibility transport; renderer project/panel components;
unit, two-client, and Electron end-to-end suites.
