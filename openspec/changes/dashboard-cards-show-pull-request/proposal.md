## Why

The Board is where the user triages agents, but a card says nothing about the
pull request its work is heading into. To see whether a PR exists or its CI is
red, the user has to leave Home and open the project's Folders sidebar, which
already shows a `PR #99` chip and a `12 running` checks chip for the folder.

## What Changes

- Every dashboard card and List row for a panel shows the pull request and
  checks chips of the folder that holds the panel, in the Folders row's words
  and colours: `PR #99`, its state when not open, and the checks count with
  failed, running, or passed.
- Every panel in one folder shows the same facts; two terminals in one worktree
  show the same pull request twice.
- The chips are read-only on the dashboard. A card keeps its one action,
  activation; opening the pull request or the checks list stays in the Folders
  sidebar.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-dashboard`: panels carry their folder's worktree facts on every
  view mode.

## Impact

- `src/workspace/workspaceInventory.ts` — inventory entries carry the folder's
  pull request and check counts.
- `src/App.tsx` — each folder workspace adds its worktree's facts to the
  inventory it publishes and republishes when they change.
- `src/workspace/dashboardRows.ts`, `src/workspace/WorkspaceDashboard.tsx`,
  `src/workspace/workspaceDashboard.css` — the model carries the facts and the
  cards and rows render them.
- No protocol, server, or extension change: the facts are the listing the
  Folders sidebar already reads.
