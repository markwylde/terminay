# Fix major server-owned state and event lifecycle regression

## Goal

Restore the intended architecture: the Terminay server owns workspace, project,
panel, and terminal state, and web/electron clients render only server snapshots
and server-emitted events. A connected client must not invent durable workspace
state, silently drop create commands, require a reconnect to show server state, or
emit unhandled disconnect errors during normal reconnect/close paths.

## User-visible failure

- Opening the web client at `http://localhost:8080` after connecting to
  `localhost:4317` can show a black/empty workspace even though a Project tab and
  connection indicator are visible.
- Clicking the sidebar can make a terminal appear, but the terminal may not be
  typeable.
- Clicking add project or add terminal can appear to do nothing.
- After reconnecting, the previously clicked new projects suddenly appear,
  showing that the server likely accepted state changes that the current client
  did not hydrate/render.
- Browser DevTools shows repeated unhandled promise rejections:
  `ClientDisconnectedError: transport disconnected`, `transport closed`, and
  `ClientDisconnectedError: client is not connected`.

## Governing specs

- `../CORE.md`
- `../features/server-owned-workspace-state.md`
- `../features/server-runtime-and-protocol.md`
- `../features/connections-and-client-hosts.md`
- `../features/workspace-and-project-tabs.md`
- `../features/terminal-workspace.md`
- `../features/remote-access.md`

## Investigation notes

- `packages/client-core/src/client.ts` makes `events.unsubscribe` a live command.
  If cleanup runs after the transport has already closed, unsubscribe calls go
  through `requireConnected()` and reject with `ClientDisconnectedError`.
- `src/shared/WorkspaceSnapshotStore.ts` calls `void this.unsubscribeEvents?.()`
  during `close()` without awaiting or suppressing expected disconnect failures.
  That matches the console stack that includes `unsubscribeEvents -> close`.
- `packages/client-core/src/fileObservation.ts` sends `files.watch.stop` as a
  command. Folder/file viewer cleanup can call this after disconnect, matching the
  console stack that includes `stopWatch`.
- `src/workspace/useProjectCollection.ts` falls back to a local `Project` when a
  `WorkspaceSnapshotStore` exists but has no snapshot yet. That violates the
  server-owned model during hydration/disconnect windows.
- The same hook silently returns from `addProject()` when the server snapshot is
  null or has no view id. This can make the plus button look broken instead of
  showing a loading/connection failure state.
- Project creation is fire-and-forget from the UI path. A disconnected command can
  become silent or unhandled instead of being represented in connection state.
- `packages/server-core/src/terminalService/protocol.ts` creates PTY sessions and
  calls `onSessionCreated`.
- `packages/server-core/src/composition.ts` maps created PTY sessions into
  workspace terminal records, but the dynamic `terminal.create` path does not
  consistently create the corresponding server-owned panel record.
- `apps/terminay-server/src/cli.ts` creates a default terminal and a default panel
  during initial workspace setup, so the default path and dynamic terminal path
  have different presentation behavior.
- `src/workspace/useTerminalCreationController.ts` expects the server delta to own
  presentation creation and waits for a matching Dockview panel by session id.
- `src/App.tsx` still has reconciliation paths that synthesize client
  presentation from server terminal sessions when no matching panel exists. That
  splits terminal presentation authority between server workspace state and
  renderer fallback behavior.
- Reproduction found two concrete UI/runtime causes in addition to the stale
  cleanup failures:
  - Browser HTTP/1 connection slots were saturated by multiple independent SSE
    streams, so later `workspace.command` calls could be accepted only after a
    reconnect. The browser transport must multiplex local event subscriptions
    over one SSE stream per transport.
  - When the shared workspace navigation was hidden, the layout used one grid
    column while the content was still pinned to column 2. That produced a
    zero-width/black workspace and pushed terminal controls out of the real hit
    target area.
- Final browser validation also found a terminal focus race: Dockview can focus
  `.dv-content-container` after the terminal pointer handler runs. A visible
  terminal click must reassert xterm focus on the next frame/tick so keyboard
  input reaches the active server-backed terminal attachment.

## Implementation tasks

- [x] Reproduce the black/empty workspace and capture the exact first failing
  event/command sequence for web connect to `localhost:4317`.
- [x] Reproduce add-project before reconnect and capture whether
  `workspace.createProject` reaches the server, whether `workspace.changed` is
  emitted, and why the current client does not render it immediately.
- [x] Reproduce add-terminal before reconnect and capture whether
  `terminal.create`, workspace terminal state, panel state, and Dockview
  presentation diverge.
- [x] Add lifecycle instrumentation or targeted test hooks around
  `TerminayClient` state transitions, `WorkspaceSnapshotStore.refresh()`,
  workspace event subscription, and reconnect/dispose paths.
- [x] Make `TerminayClient.subscribe()` unsubscribe idempotent after close. It
  must remove the local handler and avoid throwing an unhandled
  `ClientDisconnectedError` when the transport is already closed.
- [x] Make `WorkspaceSnapshotStore.close()` await or catch its unsubscribe path
  so expected disconnect cleanup cannot become an unhandled promise rejection.
- [x] Make file observation cleanup disconnect-safe, including
  `files.watch.stop` calls from folder/file viewer cleanup.
- [x] Audit activity, agent-status, query-command, file-observation, and
  workspace subscriptions for the same closed-client cleanup bug and fix all
  matching paths.
- [x] Define a single renderer connection generation model for web and electron.
  Old client contexts must be marked stale and must not issue commands after a
  newer context is active or after their transport is closed.
- [x] Update web reconnect handling so old context disposal, new context creation,
  snapshot hydration, and reconnect UI state are ordered deterministically.
- [x] Update electron/local renderer reconnect handling to follow the same
  lifecycle semantics without regressing local-mode startup.
- [x] Remove the connected-server fallback in `useProjectCollection` that creates
  a local `Project` when a `WorkspaceSnapshotStore` exists but has no snapshot.
- [x] Add an explicit loading/unavailable project workspace state for
  connected-server hydration before the first snapshot is available.
- [x] Make add-project disabled, queued, or visibly failed while the server
  workspace snapshot is unavailable. It must not silently return.
- [x] Make add-project command failures visible to renderer connection/workspace
  state and covered by tests.
- [x] Ensure server project creation emits `workspace.changed` with enough
  revision/cursor information for the client to refresh or apply the delta.
- [x] Ensure the client refreshes or applies the project-created event without
  requiring manual reload or reconnect.
- [x] Change dynamic terminal creation so the server creates the PTY session and
  the server-owned workspace panel state in one coherent transaction or
  deterministic command sequence.
- [x] Ensure dynamic terminal creation emits the workspace event only after the
  terminal session and panel state are both committed.
- [x] Update `useTerminalCreationController` so its wait condition matches the
  server-owned panel contract and surfaces failure instead of hanging/silently
  timing out.
- [x] Remove or constrain renderer panel synthesis in `src/App.tsx` so it cannot
  mask missing server-owned panel state or create a non-typeable local
  presentation.
- [x] Verify `workspace.changed` coverage for `project.create`, project root
  changes, `terminal.create`, `panel.create`, panel activation, panel close, panel
  move, and combined terminal/session/panel creation.
- [x] Add unit tests for client unsubscribe/close idempotency after transport
  close.
- [x] Add unit tests for `WorkspaceSnapshotStore.close()` after transport close.
- [x] Add unit tests for file observation watch cleanup after transport close.
- [x] Add unit tests for `useProjectCollection` when the server workspace store
  exists but the snapshot is still null.
- [x] Add server tests proving dynamic terminal creation commits both terminal
  session state and workspace panel state before emitting the workspace change.
- [x] Add web/e2e coverage for first connect rendering the default project,
  default panel, and typeable terminal.
- [x] Add web/e2e coverage for add-project rendering immediately without reload
  or reconnect.
- [x] Add web/e2e coverage for add-terminal rendering a typeable server-owned
  panel immediately without reload or reconnect.
- [x] Add web/e2e coverage for disconnect/reconnect preserving projects, panels,
  active panel, and terminal sessions without duplicate fallback projects.
- [x] Add browser-console assertions that expected close/reconnect paths do not
  produce unhandled `ClientDisconnectedError` rejections.
- [x] Fix server-owned project tab close so it cascades through the project's
  panels and terminal session records, terminates live PTYs through the
  composed terminal service, deletes the project, selects the next project, and
  never surfaces `project must be empty before close` to users. Evidence:
  `packages/server-core/src/workspace.ts`,
  `packages/server-core/src/workspaceProtocol.ts`,
  `packages/server-core/src/composition.ts`,
  `packages/server-core/test/workspace.test.mjs`, and
  `packages/server-core/test/server-composition.test.mjs`.
- [x] Fix server-owned panel/tab close so closing Terminal/File/Folder tabs
  through Dockview is mirrored to `WorkspaceClient.closePanel`, terminal panel
  close deletes its terminal session record, and live PTYs are killed by the
  composed terminal service before the next snapshot can rehydrate the tab.
  Server-owned terminal Dockview panels now keep the canonical server panel id
  instead of synthetic `terminal-N` / `pending:*` ids, so the close hook can
  address the real server panel. Evidence:
  `src/workspace/useTerminalAdoptionController.ts`,
  `src/workspace/useTerminalCreationController.ts`,
  `src/workspace/useDockviewPanelLifecycle.ts`,
  `src/shared/WorkspaceSnapshotStore.ts`, `src/App.tsx`,
  `packages/server-core/src/workspace.ts`,
  `packages/server-core/src/workspaceProtocol.ts`,
  `packages/server-core/src/composition.ts`,
  `packages/server-core/test/workspace.test.mjs`,
  `packages/server-core/test/server-composition.test.mjs`, and
  `scripts/terminal-panel-migration.test.mjs`,
  `scripts/connected-browser-create-lifecycle.test.mjs`.
- [x] Fix Explorer/sidebar Git-status flashing caused by transient refresh
  failures and connected-client callback churn. The controller now removes
  idle Git polling, preserves the last good Git projection on failed refresh,
  skips identical Git/worktree projection state updates, avoids clearing Git
  state during root/project churn, and falls back to a stable empty projection
  instead of an indefinite `Loading...` state. The connected workspace snapshot
  store also relies on `workspace.changed` subscription/resync instead of a
  1.5s full-snapshot poll. Evidence:
  `src/workspace/useFileExplorerController.ts`,
  `src/shared/WorkspaceSnapshotStore.ts`,
  `src/shared/rendererServerClient.ts`,
  `scripts/file-explorer-git-status-stability.test.mjs`,
  `scripts/workspace-change-subscription.test.mjs`, and a live Playwright
  acceptance run against `http://127.0.0.1:8081/web.html` connected to
  `http://127.0.0.1:4319` that observed the Explorer/Git sidebar for 30 seconds
  with zero DOM/class/text/color changes, zero console errors, and zero protocol
  requests during the idle observation window.
- [x] Restore Local Electron Git loading after Cmd+L/Cmd+R project-root
  changes. Server project-root updates now rebind the Git service to the
  canonical root, and Local Electron mode falls back to the native
  `terminayGitWorktreeHost` projection when the server Git projection reports
  an empty/non-repository state for an inspectable local folder. Local worktree
  move/remove/pull actions use the same host fallback. Evidence:
  `apps/terminay-server/src/cli.ts`,
  `src/workspace/useFileExplorerController.ts`,
  `electron/preload.ts`, `electron/main.ts`,
  `electron/fileViewer/gitDiffService.ts`,
  `scripts/standalone-project-root-git-binding.test.mjs`, and
  `scripts/file-explorer-git-status-stability.test.mjs`.

## Acceptance checks

- Web connect to `localhost:4317` from `http://localhost:8080` renders the
  server-owned default project, panel, and terminal without a black workspace.
- The default terminal accepts typed input after first connect.
- Clicking add project renders the new server-owned project without reload or
  reconnect.
- Clicking add terminal renders a typeable server-owned panel without reload or
  reconnect.
- Reconnecting shows the same server-owned projects, panels, active panel, and
  terminal sessions without duplicating local fallback projects.
- Closing/reconnecting does not produce unhandled `ClientDisconnectedError`
  console errors for expected unsubscribe, watch stop, or store cleanup paths.
- Closing a project with terminal/file/folder panels removes the project,
  closes its tabs, terminates its terminal sessions, and does not resurrect the
  tab or show an internal empty-project error.
- Closing terminal 2 out of 3 terminal tabs removes that panel and terminal
  session from the canonical snapshot, kills the PTY, and does not resurrect
  the tab after refresh/reconnect.
- Sidebar refresh, resize, and ordinary connected-client churn do not flash Git
  status colours between clean and changed states when the server projection is
  unchanged.
- In Local Electron mode, setting the project root from Cmd+L/Cmd+R refreshes
  Explorer and Git through the local Electron Git bridge and does not leave the
  Git pane stuck on `Loading...`.
- Unit tests cover client unsubscribe/close idempotency and
  `WorkspaceSnapshotStore.close()` after transport close.
- Unit tests cover `useProjectCollection` server-snapshot-null behavior so it does
  not create a fake local project while connected to a server store.
- Server tests cover dynamic terminal creation producing both a terminal session
  and a workspace panel event.
- Browser/e2e coverage exercises connect, add project, add terminal, disconnect,
  reconnect, and terminal typing.

## Non-goals

- Do not reintroduce renderer-authoritative durable workspace state.
- Do not hide failures behind optimistic UI that is never confirmed by the server.
- Do not make manual browser reload or reconnect part of the normal create-project
  or create-terminal workflow.

## Definition of done

- Web and electron clients share the same server-owned workspace semantics.
- Server events and snapshots are the only source of committed project, panel, and
  terminal presentation state.
- Expected transport close/reconnect paths are quiet in the browser console.
- The acceptance checks above pass in automated tests and in a manual browser run.
