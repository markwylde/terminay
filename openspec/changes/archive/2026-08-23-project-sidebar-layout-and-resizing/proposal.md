## Why

`SidebarPanelStack` recursively nested `SidebarSplit` instances. Each split clamped itself using
an approximate title height and a local minimum, so its decision could conflict with the space
the rest of the stack needed; the last pane flex-filled rather than honouring its own preference,
and separators consumed layout height below panes rather than overlaying the top edge of the
following title. Sidebar persistence also received the transient height callback, so every
pointer movement could submit a durable `project.sidebar.update` while canonical snapshot
refreshes reapplied intermediate values during the same drag.

## What Changes

- Replace the recursive splitter with one flat layout controller and one pure solver over the
  ordered visible panes, container height, measured title heights, expanded state, transient
  sizes, and preferred sizes.
- Make each visible pane's measured title height its hard minimum; allow expanded body
  allocations to shrink to zero to preserve every title; give a collapsed pane no body allocation.
- Move separators into an absolute overlay centred on the top edge of each non-first visible pane
  title, consuming no layout pixels, with directional min/max states and a reliable hit target.
- Add keyboard resizing (Arrow Up/Down, Home/End) and complete separator ARIA values driving the
  same geometry operations as pointer input.
- **BREAKING** Split transient preview callbacks from canonical commit callbacks: pointer movement
  sends no workspace update, a completed resize submits exactly one bounded sidebar patch covering
  every changed pane, and cancellation submits nothing. Connect the equivalent width preview and
  commit separation in the application.
- Reconcile canonical snapshots received during an interaction without replacing the live preview,
  and reject or order stale responses so an older height cannot snap back over a committed one.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `project-sidebar-layout`: replaces recursive nested splits with a deterministic flat solver and
  adds the preview/commit persistence boundary.

## Impact

`SidebarPanelStack`, the obsolete recursive `SidebarSplit` constraint code, `WorkspaceSplitLayout`
width preview/commit wiring in `App`, `useProjectCollection.updateProject`, and
`WorkspaceSnapshotStore.updateProjectSidebar`. Source-regex tests claiming resizing worked without
exercising geometry are removed or replaced.
