## 1. Domain model

- [x] 1.1 Define stable server, workspace-view, project, panel, and terminal-session ids and their ownership relationships, verified by model invariant unit tests.
- [x] 1.2 Model terminal, file, and folder panel state without importing Dockview types into server-core, verified by server-core having no Dockview import.
- [x] 1.3 Model normalized split/order/active state separately from native window ids and screen pixels, verified by snapshot reconstruction tests.
- [x] 1.4 Define close semantics separately for client window, logical workspace view, panel, and PTY, verified by lifecycle tests for each case.
- [x] 1.5 Define interruption/tombstone representation for sessions that were live before a server restart, verified by restart tests marking formerly live PTYs interrupted.

## 2. Commands and revisions

- [x] 2.1 Implement snapshot, ordered event, expected-revision, idempotent command id, conflict, delta, and full-resync behaviour, verified by duplicate-command and stale-revision tests.
- [x] 2.2 Add scoped commands for project/view/panel create, update, reorder, move, split, activate, and close, verified by per-command unit coverage.
- [x] 2.3 Make multi-object moves one atomic committed revision, verified by an atomic move test.
- [x] 2.4 Enforce object/server/project boundaries independently of client focus or labels, verified by invalid cross-scope id tests.
- [x] 2.5 Add deterministic optimistic-update/rollback helpers only for safe UI mutations, verified by rollback unit tests.

## 3. Persistence

- [x] 3.1 Implement the schema-versioned state repository and atomic commit path, verified by durability tests across restart.
- [x] 3.2 Add backup/recovery and idempotent migration primitives, verified by repeated-migration tests.
- [x] 3.3 Persist only documented canonical state, excluding modal, hover, drag geometry, search text, and unbounded terminal content, verified by a persistence inventory test.
- [x] 3.4 Report missing roots and interrupted sessions without silently replacing them; `reportWorkspaceRecovery` returns explicit metadata while preserving canonical project/session ids, verified by recovery reporting tests.

## 4. Compatibility integration

- [x] 4.1 Introduce a `TerminayClient` workspace API and adapt the current renderer to it, verified by the renderer running unchanged components against the new client.
- [x] 4.2 Seed the first canonical workspace from the current/default renderer model and persist forward through bounded `view.create`, `project.create`/`project.move`, `terminal.create`, and panel commands with expected revisions, verified by seeding tests that discard renderer/window fields and do not resurrect interrupted sessions.
- [x] 4.3 Replace opaque cross-window adopted-project payloads with a write-scoped `project.move` operation and `WorkspaceClient.moveProject`, verified by a framed client/server test preserving panel and session ids.
- [x] 4.4 Remove PTY ownership from `webContentsId` so renderer subscriptions become detachable consumers, verified by `ServerTerminalAuthority` bounded consumer-token tests.
- [x] 4.5 Keep a temporary Electron IPC transport adapter behind the shared client contract, wrapping every framed MessagePort packet in a fixed versioned server scope, verified by focused tests rejecting mismatched or malformed scopes.

## 5. Tests

- [x] 5.1 Unit-test model invariants, invalid cross-scope ids, atomic moves, duplicate commands, stale revisions, delta/resync, and migrations.
- [x] 5.2 Add two-client tests covering simultaneous non-conflicting and conflicting commands.
- [x] 5.3 Add renderer reload and window close tests proving workspace and PTY identity remain intact through the compatibility boundary.
- [x] 5.4 Preserve project drag, split, rename, close, popout, and adoption end-to-end coverage, verified by `e2e/project-tabs.spec.ts` (2/2) and `e2e/workspace.spec.ts` (7/7).
