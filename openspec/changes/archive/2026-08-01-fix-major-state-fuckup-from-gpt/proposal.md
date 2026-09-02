## Why

Opening the web client against a connected server could show a black, empty
workspace with a visible Project tab; a terminal that appeared after clicking
the sidebar was often not typeable; add-project and add-terminal appeared to do
nothing and then all appeared at once after a reconnect; and DevTools filled
with unhandled `ClientDisconnectedError` rejections during ordinary close and
reconnect. The renderer had drifted into inventing durable workspace state,
which broke the server-owned model.

## What Changes

- Make client teardown disconnect-safe: `TerminayClient` unsubscribe is
  idempotent after close, `WorkspaceSnapshotStore.close()` awaits or suppresses
  its unsubscribe, and file-observation `files.watch.stop` cleanup no longer
  throws. Activity, agent-status, query-command, file-observation, and workspace
  subscriptions are audited for the same bug.
- Introduce one renderer connection generation model for web and Electron. A
  stale context is marked stale and issues no commands.
- **BREAKING** Remove the `useProjectCollection` fallback that created a local
  `Project` when a `WorkspaceSnapshotStore` existed with no snapshot. Connected
  hydration now has an explicit loading/unavailable state, and add-project is
  disabled, queued, or visibly failed rather than silently returning.
- Make dynamic terminal creation commit the PTY session and the server-owned
  panel record together, emitting `workspace.changed` only after both are
  committed, and remove renderer panel synthesis in `src/App.tsx`.
- Fix server-owned project close so it cascades through panels and terminal
  session records, terminates live PTYs, deletes the project, and never surfaces
  `project must be empty before close`.
- Fix panel/tab close so Dockview closes mirror to `WorkspaceClient.closePanel`
  using canonical server panel ids rather than synthetic `terminal-N` /
  `pending:*` ids.
- Stop Explorer/sidebar Git-status flashing: preserve the last good projection
  on failed refresh, skip identical projections, and replace the 1.5s
  full-snapshot poll with `workspace.changed` subscription and resync.
- Restore Local Electron Git loading after Cmd+L/Cmd+R root changes by rebinding
  the Git service to the canonical root with a native host fallback.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `server-owned-workspace-state`: the client role, optimistic UI limits,
  command-first panel close, cross-client convergence, and disconnect/restart
  lifecycle.
- `terminal-workspace`: terminal creation as a server-owned mutation and the
  prohibition on renderer-invented panel identity.
- `workspace-and-project-tabs`: terminal removal and reconciliation, and
  renderer detachment not counting as a panel close.

## Impact

`packages/client-core` (`client.ts`, `fileObservation.ts`),
`src/shared/WorkspaceSnapshotStore.ts`, `src/shared/rendererServerClient.ts`,
`src/workspace/*` controllers, `src/App.tsx`,
`packages/server-core` (`workspace.ts`, `workspaceProtocol.ts`,
`composition.ts`, `terminalService/protocol.ts`),
`apps/terminay-server/src/cli.ts`, and the Electron Git bridge.
