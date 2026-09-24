## 1. Prerequisites

- [x] 1.1 Confirm `dashboard-views-and-agent-detail` and `dashboard-board-group-by-project` are implemented on `main` (verified: `DASHBOARD_BOARD_COLUMNS` and the "Group by project" control exist in `src/workspace/`).

## 2. Column order

- [x] 2.1 Change `DASHBOARD_BOARD_COLUMNS` in `src/workspace/dashboardViewMode.ts` to `['idle', 'working', 'attention', 'done']` (verified: `npm run typecheck` passes and the ungrouped and grouped Board render Idle | Working | Needs you | Done in the running app).
- [x] 2.2 Add an assertion in `scripts/dashboard-agent-model.test.mjs` that `DASHBOARD_BOARD_COLUMNS` equals `['idle', 'working', 'attention', 'done']` (verified: `node --test scripts/dashboard-agent-model.test.mjs` passes, and fails against the old order).
- [x] 2.3 In `e2e/workspace-dashboard.spec.ts`, assert the `data-terminay-dashboard-column` values of the Board's column headers, ungrouped and inside a grouped lane, read `idle, working, attention, done` (verified: `npm run test:e2e` passes for that spec).

## 3. Close out

- [x] 3.1 Validate the change (verified: `openspec validate dashboard-board-column-order` passes).
- [ ] 3.2 Archive only after both prerequisite changes are archived (verified: `openspec archive dashboard-board-column-order` applies its MODIFIED requirements without a missing-requirement error).
