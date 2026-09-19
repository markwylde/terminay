## 1. Model and memory

- [x] 1.1 Add `DashboardBoardLane` and `buildDashboardBoardLanes` to
      `dashboardViewMode.ts`, built from `buildDashboardBoardItems` and
      `groupBoardItemsByColumn` per project group. Verified by
      `node --test scripts/dashboard-agent-model.test.mjs` asserting lane order,
      per-lane columns, no lane for a project with no cards, and that the
      grouped and ungrouped Board hold the same card keys.
- [x] 1.2 Add `rememberDashboardBoardGrouped` / `recallDashboardBoardGrouped`
      to `localViewState.ts`, best-effort and defaulting to ungrouped. Verified
      by `node --test scripts/local-view-state.test.mjs` covering the round
      trip, a nonsense stored value, and storage that throws.

## 2. The grouped Board renders

- [x] 2.1 Render a "Group by project" checkbox in the dashboard header while
      the Board is selected, and the lanes — a shared column header, then a
      heading and four cells per project — when it is ticked. Verified by
      `npm run typecheck:workspaces` and the e2e case in 3.1.
- [x] 2.2 Style the lanes in `workspaceDashboard.css`, reflowing to two and
      then one cell per row on a narrow window with each cell naming its own
      column. Verified by `npm run lint` and by reading the rendered Board at
      wide and narrow widths.

## 3. End-to-end coverage

- [x] 3.1 Add an e2e case that the control is absent off the Board, that
      grouping shows a four-column lane for the project with the same card
      count as the ungrouped Board, that the grouping survives leaving Home,
      and that a lane heading activates its project. Verified by that case
      passing under `npm run test:e2e`.

## 4. Specs and checks

- [x] 4.1 Run `openspec validate --all`, `npm run lint`,
      `npm run typecheck:workspaces`, and the touched `node --test` suites.
      Verified by all four reporting clean.
- [ ] 4.2 Open the pull request on Gitea with `tea`, then read back every
      commit status on the head SHA and confirm each is `success` or `skipped`
      before calling it green. Verified by the status listing itself.
