# Server-owned workspace model

## Goal

Introduce the canonical server workspace/view/project/panel model, revisioned
commands, persistence, and client synchronization while retaining a
compatibility path for the current Electron renderer.

## Governing specifications

- [Server-owned workspace state](../features/server-owned-workspace-state.md)
- [Workspace and project tabs](../features/workspace-and-project-tabs.md)
- [Terminal workspace](../features/terminal-workspace.md)

## Why this is active

Projects, Dockview layouts, terminal metadata, active panels, and cross-window
movement currently live in `src/App.tsx`. Electron owns PTYs by
`webContentsId`, and renderer destruction kills those sessions. No fresh client
can reconstruct the full workspace from authoritative state.

## Dependencies

- [Workspace and protocol foundation](../tasks_completed/4-workspace-and-protocol-foundation.md)

## Work slices

### Domain model

- [x] Define stable server, workspace-view, project, panel, and terminal-session
  ids and their ownership relationships.
- [x] Model terminal, file, and folder panel state without importing Dockview
  types into server-core.
- [x] Model normalized split/order/active state separately from native window
  ids and screen pixels.
- [x] Define close semantics separately for client window, logical workspace
  view, panel, and PTY.
- [x] Define interruption/tombstone representation for sessions that were live
  before a server restart.

### Commands and revisions

- [x] Implement snapshot, ordered event, expected-revision, idempotent command
  id, conflict, delta, and full-resync behaviour.
- [x] Add scoped commands for project/view/panel create, update, reorder, move,
  split, activate, and close.
- [x] Make multi-object moves one atomic committed revision.
- [x] Enforce object/server/project boundaries independently of client focus or
  labels.
- [x] Add deterministic optimistic-update/rollback helpers only for safe UI
  mutations.

### Persistence

- [x] Implement the selected schema-versioned state repository and atomic
  commit path.
- [x] Add backup/recovery and idempotent migration primitives.
- [x] Persist only documented canonical state; exclude modal, hover, drag
  geometry, search text, and unbounded terminal content.
- [x] Report missing roots and interrupted sessions without silently replacing
  them. `reportWorkspaceRecovery` returns explicit metadata while preserving
  canonical project/session ids and state.

### Compatibility integration

- [x] Introduce a `TerminayClient` workspace API and adapt the current renderer
  to it without immediately changing every component.
- [x] Seed the first canonical workspace from the current/default renderer model
  and persist from that point forward through bounded `view.create`,
  `project.create`/`project.move`, `terminal.create`, and panel commands with
  expected revisions; renderer/window fields are discarded and interrupted
  sessions are not resurrected.
- [ ] Replace opaque cross-window adopted-project payloads with server move
  commands while preserving current drag UX.
- [ ] Remove PTY ownership from `webContentsId`; renderer subscriptions become
  detachable consumers.
- [x] Keep a temporary Electron IPC transport adapter behind the shared client
  contract until the local server process task replaces it. The Desktop
  compatibility bridge wraps every framed MessagePort packet in a fixed,
  versioned server scope and exposes only `TerminayClient` to the renderer;
  focused tests reject mismatched or malformed scopes.

### Tests

- [x] Unit-test model invariants, invalid cross-scope ids, atomic moves,
  duplicate commands, stale revisions, delta/resync, and migrations.
- [x] Add two-client tests covering simultaneous non-conflicting and conflicting
  commands.
- [x] Add renderer reload/window close tests proving workspace and PTY identity
  remain intact through the compatibility boundary: recreating the renderer
  context and unbinding the native window leaves the server-scoped client and
  terminal attachment connected with the same immutable identity.
- [ ] Preserve current project drag, split, rename, close, popout, and adoption
  E2E coverage through the compatibility adapter.

## Acceptance checks

- A fresh test client reconstructs projects, panels, logical layout, and active
  identities from one server snapshot.
- Closing/reloading a renderer no longer kills its PTYs.
- Concurrent conflicting moves produce one commit and one explicit conflict,
  never duplicated panels or sessions.
- Moving a project between logical views preserves every panel/session id.
- Restart reloads durable state and marks formerly live PTYs interrupted.

## Definition of done

Server-core is the only canonical workspace authority. The current desktop UI
still works through `TerminayClient`, and no authorization or lifecycle decision
depends on Electron window ids, Dockview serialization, or renderer-local
project membership.
