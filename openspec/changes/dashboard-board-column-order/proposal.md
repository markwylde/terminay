## Why

The dashboard Board reads left to right as Needs you | Working | Done | Idle. That puts the resting state last and the triage state first, so cards do not move across the board the way work does: an agent starts Idle, goes Working, may stop to Need you, and ends Done. Users scanning the board expect the columns in that lifecycle order.

## What Changes

- The Board's status columns are presented in lifecycle order: **Idle | Working | Needs you | Done**.
- The grouped Board ("Group by project") uses the same column order inside every lane.
- Column labels, the status each column holds, and what counts as "needs you" are unchanged. The column keeps its existing "Needs you" label.
- The header summary chips (need you, working, done, idle) are not reordered by this change.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `workspace-dashboard`: the Board requirement and the Board-grouping requirement name the four status columns in the order Idle, Working, Needs you, Done, and require the columns to be presented in that order.

## Impact

- `src/workspace/dashboardViewMode.ts` — `DASHBOARD_BOARD_COLUMNS` order, the single source both the ungrouped and grouped Board iterate.
- `scripts/dashboard-agent-model.test.mjs` — a column-order assertion.
- `e2e/workspace-dashboard.spec.ts` — a column-order assertion on the rendered Board.
- Depends on the unarchived `dashboard-views-and-agent-detail` and `dashboard-board-group-by-project` changes, which introduce the requirements this change modifies; it must archive after both.
