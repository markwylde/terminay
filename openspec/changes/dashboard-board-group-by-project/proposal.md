## Why

The Board sorts every agent and tab by what it needs from you, and drops the
project grouping to do it. With several projects open that makes a column a
mixed pile: a card names its project in small text, but there is no way to see
at a glance what one project is doing across the four states. The Projects view
answers "what is in this project" and loses the columns; the Board keeps the
columns and loses the project. Nothing shows both.

## What Changes

- The Board gains a "Group by project" checkbox in the dashboard header, shown
  only while the Board is the selected view.
- Ticked, the Board keeps its four status columns and bands them into one lane
  per project. The column names are stated once above the lanes; each lane names
  its project and holds that project's cards under the same four columns.
- A lane's cards are exactly the cards the ungrouped Board shows for that
  project. A project with nothing in any column gets no lane, as it gets no
  card today.
- A lane's heading activates its project, the way a project heading does in the
  other views.
- The choice is remembered per device, beside the remembered view mode, and is
  a hint: unreadable storage is the ungrouped Board and no error.
- List, Projects, and the ungrouped Board are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-dashboard`: the Board view can band its status columns by project,
  as per-device presentation state.

## Impact

- `src/workspace/dashboardViewMode.ts` — `DashboardBoardLane` and
  `buildDashboardBoardLanes`, built from the existing board items.
- `src/workspace/localViewState.ts` — `rememberDashboardBoardGrouped` /
  `recallDashboardBoardGrouped`.
- `src/workspace/WorkspaceDashboard.tsx` — the checkbox and the lanes.
- `src/workspace/workspaceDashboard.css` — lane layout, including the narrow
  reflow.
- `scripts/dashboard-agent-model.test.mjs`, `scripts/local-view-state.test.mjs`,
  `e2e/workspace-dashboard.spec.ts`.
- Sequencing: this change sits on `dashboard-views-and-agent-detail`, which is
  implemented and merged but not yet archived. The delta adds a requirement
  beside that change's "Dashboard view modes" rather than modifying it.
