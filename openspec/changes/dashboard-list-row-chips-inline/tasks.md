## 1. Layout

- [x] 1.1 In `src/workspace/workspaceDashboard.css`, set `.workspace-dashboard__row--panel` to `14px 3px 15px minmax(0, auto) minmax(0, 1fr) auto auto`. Place `.workspace-dashboard__row-detail`, `.workspace-dashboard__worktree` and `.workspace-dashboard__server` in columns 5, 6 and 7 within panel rows, and give the row's worktree container `min-width: max-content; overflow: visible` (verify: e2e in 2.1)

## 2. Verification

- [x] 2.1 Add an e2e layout test on a wide List view. Add a worktree chip element to a real panel row, both with and without a detail, and assert that the chip's box lies within the row's box vertically, sits after the title (and after the detail when present), and is not clipped (`scrollWidth <= clientWidth`). Capture a screenshot (verify: `npm run test:e2e` for that spec passes)
- [x] 2.2 Run typecheck, lint, `openspec validate dashboard-list-row-chips-inline` and `openspec validate --all` (verify: this change is clean; any `--all` failures are named as existing ones in other changes)
