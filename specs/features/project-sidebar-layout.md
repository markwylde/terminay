# Project sidebar layout

## Summary

Each project presents a sidebar with three groups — Explorer, Documentation, and
Agents — selected from a tab bar at the top of the sidebar. The Explorer group
contains Files and Git; Documentation contains Documentation; Agents contains
Agents. Each group is a vertically resizable pane stack. The active stack always
keeps every visible pane title on-screen, gives scrolling to pane content rather
than the whole sidebar, and restores that project's preferred dimensions through
canonical
[server-owned workspace state](./server-owned-workspace-state.md).

## Groups

- The sidebar tab bar sits above the pane stack and uses the same project
  chrome as the active project tab and panel tab strip, so the colour continues
  across that band. It has three tabs, in order:
  Explorer (file/folder icon), Documentation, and Agents. Future panes join one
  of these groups rather than becoming a fourth top-level tab.
- Selecting a tab shows only that group's panes. Hidden groups retain their
  stored heights, collapse choices, and order.
- The Agents tab is omitted when agent integration is disabled. If that tab was
  selected, Explorer is shown instead without rewriting the stored selection.
- The selected group is a device-local preference keyed by the selected server
  and project, like sidebar open/closed visibility. It does not sync to another
  device and does not belong to canonical project layout.
- Pane reorder is confined to the active group. Files cannot be dragged into
  Documentation or Agents.

## Layout and resizing

- The sidebar stack occupies its available height below the group tab bar
  without an outer vertical scrollbar. Each expanded pane body owns any
  scrolling required by its content.
- Every visible pane title in the active group remains completely inside the
  sidebar viewport while panes are resized, collapsed, expanded, reordered,
  restored, or relaid out after a window-size change. An expanded body yields
  all of its usable height before a title can be clipped or pushed off-screen.
- A collapsed pane occupies exactly its title height. The layout uses the
  title's rendered height as its hard minimum rather than an approximate
  constant.
- Expanded panes in the active group share the pixels remaining after all
  visible titles in that group have been reserved. Preferred body minima may
  influence distribution when room exists, but may not override title
  visibility.
- The layout resolves all visible panes in the active group together. A resize
  boundary cannot use a local constraint that contradicts the space required by
  another pane in that group.
- A resize separator is centred on the top edge of the following pane's title,
  matching the VS Code interaction model. It overlays the boundary and does not
  consume layout height. Hover shows a 4px light rail centred on that
  boundary after 100ms; dragging and keyboard focus show it immediately.
  Never a filled sash. The pointer hit target stays large enough to acquire
  reliably.
- Dragging a separator continuously previews the resulting pane sizes. Movement
  is clamped using the available grow and shrink capacity of every affected pane
  on both sides of the boundary, so the pointer does not jump and no pane crosses
  its hard minimum.
- All panes, including the final pane in a group, retain an independent size
  preference. Reordering a pane does not transfer another pane's preference or
  make the moved pane's preference inapplicable merely because it is last.
- Collapsing, expanding, reordering, adding or removing a registered pane,
  switching groups, and resizing the window run through the same deterministic
  normalization rules. If a temporarily smaller viewport clamps a preferred size,
  growing the viewport restores that preference unless the user committed a new
  resize.
- Terminay's supported window and embedded-client layouts provide at least the
  combined title height of the active group's panes plus the group tab bar. If
  that invariant cannot be met, the host constrains or adapts the presentation
  explicitly; it does not silently hide titles or introduce an outer sidebar
  scroll position.
- Normal Electron project windows enforce a 260px native minimum height. This
  leaves room for the project tab bar, sidebar group tabs, the active group's
  pane titles, and a usable workspace body; auxiliary windows do not inherit this
  project-layout constraint. A web or embedded host below the measured title
  budget presents a non-scrolling status that states the required sidebar height
  and asks the user to increase the window height, rather than rendering a
  clipped partial stack.

## Persistence and synchronization

- Pane dimensions, order, and collapse state belong to the project. Switching
  projects immediately presents the selected project's own sidebar layout and
  that device's selected group for the project.
- Sidebar open/closed visibility and the selected group belong to the current
  device and project. They are stored with device preferences under the selected
  server and opaque project id, so toggling a sidebar or switching Explorer /
  Documentation / Agents affects neither another device nor another project. A
  device that has no preference for a project presents the sidebar closed and
  the Explorer group.
- Pointer movement is presentation-local preview state. It does not submit
  workspace commands, publish workspace revisions, or allow an incoming
  canonical snapshot to fight the in-progress drag.
- Completing a pointer or keyboard resize commits the final normalized
  preference vector for every visible expanded pane in the active group once
  through one project-scoped sidebar update. This preserves the rendered
  boundary when the local preview yields to controlled state; collapsed panes
  retain their stored body preference. Cancelling a resize restores the pre-drag
  presentation and does not commit it.
- Canonical snapshots received during a drag are reconciled after the local
  interaction finishes. An older snapshot cannot overwrite a newer completed
  resize.
- Sidebar width follows the same preview/commit boundary: live pointer movement
  is local and one final width is committed when resizing finishes.
- Restored dimensions are preferences, not trusted layout instructions. They are
  validated and normalized against the current pane set and container geometry
  before rendering.

## Input and accessibility

- The group tab bar is a tab list. Each tab names its group, keyboard users can
  move between tabs, and the active tab's pane stack is the corresponding tab
  panel.
- Every separator exposes horizontal orientation, its current value, and its
  effective minimum and maximum through separator semantics.
- A focused separator supports incremental resizing with Arrow Up and Arrow
  Down, and boundary resizing with Home and End. Keyboard resizing uses the same
  solver and single-commit behavior as pointer resizing.
- Resize handling supports pointer capture, prevents text selection and native
  dragging, and keeps window-level listeners for the gesture. Losing capture
  because the separator moved with the preview does not cancel the resize;
  pointer-up still commits it. pointercancel, window blur, hidden visibility,
  and unmount cancel it.
- A separator communicates when movement in one or both directions is exhausted
  through its cursor and accessible values; an enabled-looking handle must not
  silently ignore movement.

## Boundaries and non-goals

Pane content remains owned by its feature and project environment. The layout
controller knows pane identity, title geometry, expansion state, preferred size,
and resize constraints; it does not read files, Git state, agent state, or
Documentation content. This feature does not make sidebar preferences global,
does not write them into project files, and does not introduce renderer
filesystem authority.

The stack needs only Terminay's vertical project-sidebar behavior. It does not
need to reproduce VS Code's general-purpose SplitView API, snapping modes, or
unrelated workbench layout system.

## Acceptance outcomes

- The sidebar tab bar switches Explorer, Documentation, and Agents. Explorer
  shows Files and Git; Documentation shows Documentation; Agents shows Agents.
  Panes from another group are not visible.
- With every pane in the active group visible, every title's bounding box stays
  within the sidebar at supported window heights, before, during, and after
  resizing.
- The sidebar element itself never scrolls vertically; an overflowing Files,
  Agents, Git, or Documentation body scrolls without moving any title.
- A separator at the top of the following title in a multi-pane group resizes
  continuously across its full permitted range and remains usable after repeated
  drags in both directions.
- A resize produces no canonical sidebar commands during pointer movement and
  exactly one project-scoped command on completion. Cancellation produces none.
- Shrinking and regrowing the window preserves preferred dimensions while
  maintaining title visibility. Collapse, expansion, reorder, group switching,
  and project switching preserve the correct pane identities and preferences.
- Restarting or reloading the same device restores its sidebar visibility and
  selected group for each project. Reconnecting or opening another client
  restores the committed project layout without replaying transient drag states,
  while that client's sidebar visibility and selected group remain its own
  device preferences.
- Pointer and keyboard resizing pass the same geometry, persistence, and
  accessibility expectations in the shared desktop and web renderer.
