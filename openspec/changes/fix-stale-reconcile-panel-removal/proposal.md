## Why

A terminal the user creates can vanish moments after it appears. The tab shows
up, then it is taken away again, and the shell behind it is gone — the session is
closed on the server, not merely hidden. It happens while a second window is
open on the same workspace (a popped-out project), which is exactly when the
user is most likely to be opening terminals in bulk, and it can take several
terminals in a row.

The cause is a workspace reconciliation retry that keeps the snapshot it was
scheduled with. A newer snapshot cancels the pending reconciliation frame but not
the retry timer, so the retry later drives presentation from a snapshot that is
behind the client's own confirmed projection. That old panel list does not
contain the terminal that has since been adopted, so the panel is removed — and
Dockview removal is command-first, so it closes the canonical panel and its PTY.
Each close is a new revision, which re-arms the retry window, so the loop feeds
itself until the user stops creating terminals.

## What Changes

- Workspace presentation reconciliation only ever runs against the newest
  validated snapshot. A retry re-reads the current projection instead of
  replaying the snapshot it was scheduled with.
- A newer snapshot cancels any pending retry, in the same way it already cancels
  a pending reconciliation frame.
- Panel removal is driven only by a snapshot that is current: a reconciliation
  pass whose snapshot is behind the client's confirmed projection never removes a
  panel.
- End-to-end coverage for creating terminals in one window while another window
  presents a project of the same workspace.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `server-owned-workspace-state`: presentation reconciliation is pinned to the
  newest confirmed projection — a retried or superseded pass cannot remove a
  panel, and therefore cannot close a live terminal session.

## Impact

- `src/App.tsx` — the workspace reconciliation effect (retry scheduling and
  cancellation) and `reconcileServerPanels`.
- Terminal session lifecycle: a client-side removal currently reaches the server
  through `closeServerPanel` in `src/workspace/useDockviewPanelLifecycle.ts`,
  which is why the defect destroys PTYs rather than just tabs.
- `e2e/rapid-terminal-creation.spec.ts` — reproduction and regression coverage.
