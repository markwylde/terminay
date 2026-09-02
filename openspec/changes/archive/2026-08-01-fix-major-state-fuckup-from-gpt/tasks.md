## 1. Reproduction and instrumentation

- [x] 1.1 Reproduce the black/empty workspace and capture the exact first
  failing event/command sequence for a web connect to `localhost:4317`
- [x] 1.2 Reproduce add-project before reconnect and capture whether
  `workspace.createProject` reaches the server, whether `workspace.changed` is
  emitted, and why the client does not render it immediately
- [x] 1.3 Reproduce add-terminal before reconnect and capture where terminal
  state, panel state, and Dockview presentation diverge
- [x] 1.4 Add lifecycle instrumentation around `TerminayClient` state
  transitions, `WorkspaceSnapshotStore.refresh()`, workspace event subscription,
  and reconnect/dispose paths, verified by the captured traces

## 2. Disconnect-safe client cleanup

- [x] 2.1 Make `TerminayClient.subscribe()` unsubscribe idempotent after close so
  it removes the local handler without an unhandled `ClientDisconnectedError`,
  verified by unit tests for unsubscribe after transport close
- [x] 2.2 Make `WorkspaceSnapshotStore.close()` await or catch its unsubscribe
  path, verified by unit tests for close after transport close
- [x] 2.3 Make file observation cleanup, including `files.watch.stop` from
  folder/file viewer cleanup, disconnect-safe, verified by unit tests for watch
  cleanup after transport close
- [x] 2.4 Audit activity, agent-status, query-command, file-observation, and
  workspace subscriptions for the same closed-client bug and fix every matching
  path, verified by the audit and its tests

## 3. Connection generation model

- [x] 3.1 Define a single renderer connection generation model for web and
  Electron so stale contexts issue no commands, verified by lifecycle tests
- [x] 3.2 Order web reconnect disposal, context creation, snapshot hydration, and
  reconnect UI deterministically, verified by
  `scripts/web-reconnect-attempt-lifecycle.test.mjs`
- [x] 3.3 Apply the same lifecycle semantics to the Electron/local renderer
  without regressing local-mode startup, verified by local startup coverage

## 4. Server-owned project and panel state

- [x] 4.1 Remove the connected-server fallback in `useProjectCollection` that
  creates a local `Project` when the snapshot is null, verified by unit tests for
  the server-store-with-null-snapshot case
- [x] 4.2 Add an explicit loading/unavailable project workspace state for
  connected hydration before the first snapshot, verified by renderer tests
- [x] 4.3 Make add-project disabled, queued, or visibly failed while the snapshot
  is unavailable rather than silently returning, verified by renderer tests
- [x] 4.4 Surface add-project command failures in renderer connection/workspace
  state, verified by tests
- [x] 4.5 Ensure server project creation emits `workspace.changed` with enough
  revision/cursor information to refresh or apply the delta, verified by
  server-core workspace tests
- [x] 4.6 Ensure the client applies the project-created event without a manual
  reload or reconnect, verified by web E2E coverage

## 5. Terminal creation and presentation authority

- [x] 5.1 Make dynamic terminal creation create the PTY session and the
  server-owned panel state in one coherent transaction or deterministic command
  sequence, verified by server tests
- [x] 5.2 Emit the workspace event only after the terminal session and panel
  state are both committed, verified by server tests
- [x] 5.3 Update `useTerminalCreationController` so its wait condition matches
  the server-owned panel contract and surfaces failure instead of hanging,
  verified by renderer tests
- [x] 5.4 Remove or constrain renderer panel synthesis in `src/App.tsx` so it
  cannot mask missing server panel state or create a non-typeable presentation,
  verified by the connected create-lifecycle test
- [x] 5.5 Verify `workspace.changed` coverage for `project.create`, project root
  changes, `terminal.create`, `panel.create`, panel activation, panel close,
  panel move, and combined terminal/session/panel creation

## 6. Close cascades

- [x] 6.1 Fix server-owned project tab close so it cascades through the
  project's panels and terminal session records, terminates live PTYs through
  the composed terminal service, deletes the project, selects the next project,
  and never surfaces `project must be empty before close`. Evidence:
  `packages/server-core/src/workspace.ts`,
  `packages/server-core/src/workspaceProtocol.ts`,
  `packages/server-core/src/composition.ts`,
  `packages/server-core/test/workspace.test.mjs`,
  `packages/server-core/test/server-composition.test.mjs`
- [x] 6.2 Fix panel/tab close so Dockview closes mirror to
  `WorkspaceClient.closePanel`, terminal panel close deletes its terminal
  session record, and live PTYs are killed before the next snapshot can
  rehydrate the tab, with server-owned terminal panels keeping the canonical
  server panel id instead of synthetic `terminal-N` / `pending:*` ids. Evidence:
  `src/workspace/useTerminalAdoptionController.ts`,
  `src/workspace/useTerminalCreationController.ts`,
  `src/workspace/useDockviewPanelLifecycle.ts`,
  `src/shared/WorkspaceSnapshotStore.ts`, `src/App.tsx`, the server-core
  workspace and composition sources and tests,
  `scripts/terminal-panel-migration.test.mjs`, and
  `scripts/connected-browser-create-lifecycle.test.mjs`

## 7. Sidebar and Git stability

- [x] 7.1 Fix Explorer/sidebar Git-status flashing by removing idle Git polling,
  preserving the last good projection on failed refresh, skipping identical
  projection updates, not clearing Git state during root/project churn, and
  falling back to a stable empty projection instead of an indefinite
  `Loading...`; and replace the 1.5s full-snapshot poll with `workspace.changed`
  subscription and resync. Evidence:
  `src/workspace/useFileExplorerController.ts`,
  `src/shared/WorkspaceSnapshotStore.ts`, `src/shared/rendererServerClient.ts`,
  `scripts/file-explorer-git-status-stability.test.mjs`,
  `scripts/workspace-change-subscription.test.mjs`, and a live Playwright
  acceptance run against `http://127.0.0.1:8081/web.html` connected to
  `http://127.0.0.1:4319` that observed the sidebar for 30 seconds with zero
  DOM/class/text/colour changes, zero console errors, and zero protocol requests
- [x] 7.2 Restore Local Electron Git loading after Cmd+L/Cmd+R project-root
  changes by rebinding the Git service to the canonical root and falling back to
  the native `terminayGitWorktreeHost` projection for an inspectable local
  folder. Evidence: `apps/terminay-server/src/cli.ts`,
  `src/workspace/useFileExplorerController.ts`, `electron/preload.ts`,
  `electron/main.ts`, `electron/fileViewer/gitDiffService.ts`,
  `scripts/standalone-project-root-git-binding.test.mjs`, and
  `scripts/file-explorer-git-status-stability.test.mjs`

## 8. End-to-end coverage

- [x] 8.1 Add web E2E coverage for first connect rendering the default project,
  default panel, and a typeable terminal
- [x] 8.2 Add web E2E coverage for add-project rendering immediately without
  reload or reconnect
- [x] 8.3 Add web E2E coverage for add-terminal rendering a typeable
  server-owned panel immediately without reload or reconnect
- [x] 8.4 Add web E2E coverage for disconnect/reconnect preserving projects,
  panels, active panel, and terminal sessions without duplicate fallback
  projects
- [x] 8.5 Add browser-console assertions that expected close/reconnect paths
  produce no unhandled `ClientDisconnectedError` rejections
