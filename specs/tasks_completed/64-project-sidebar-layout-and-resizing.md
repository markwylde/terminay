# Project sidebar layout and resizing

## Goal

Replace the project sidebar's recursive binary resizing with one deterministic
vertical layout model that keeps every pane title visible, places resize handles
at the top of the following title, and commits each completed resize exactly
once.

## Governing specifications

- [Project sidebar layout](../features/project-sidebar-layout.md)
- [Workspace and project tabs](../features/workspace-and-project-tabs.md)
- [Server-owned workspace state](../features/server-owned-workspace-state.md)
- [File explorer and folder tabs](../features/file-explorer-and-folder-tabs.md)
- [Agent status and Agents sidebar](../features/agent-status-and-sidebar.md)
- [Git worktrees and Quick Push](../features/git-worktrees-and-quick-push.md)
- [Documentation sidebar and editor](../features/documentation-sidebar-and-editor.md)

## Original gap

`SidebarPanelStack` recursively nests `SidebarSplit` instances. Each split
clamps itself using an approximate title height and a local minimum, so its
decision can conflict with the space required by the rest of the stack. The
last pane flex-fills rather than consistently honoring its own preference, and
the separators consume layout height below panes rather than overlaying the top
edge of the following title.

Sidebar persistence also receives the transient height callback. Every pointer
movement can therefore submit a durable `project.sidebar.update`, while
canonical snapshot refreshes can reapply intermediate values during the same
drag. The equivalent sidebar-width commit path exists in
`WorkspaceSplitLayout` but is not connected by the application. Existing tests
do not exercise real vertical pointer resizing, title geometry, or workspace
command counts.

## Completion status

Implemented. The recursive splitter and per-movement persistence paths have
been replaced by the flat layout model and committed-resize flow described
below. The governing feature specifications now describe the shipped contract.

## Architecture delivered

Use the resize invariants from VS Code's `PaneView`/`SplitView` as design input,
without importing or recreating its general workbench framework.

1. One flat layout controller owns the ordered visible panes, container height,
   rendered title heights, expanded state, transient sizes, and preferred sizes.
2. The hard minimum for every visible pane is its measured title height. A
   collapsed pane has no body allocation. Expanded body allocations may shrink
   to zero when necessary to preserve every title.
3. One pure solver normalizes the whole stack. It reserves the complete title
   budget, distributes remaining pixels deterministically, and handles resize,
   restore, collapse, expansion, reorder, registration changes, and container
   changes without recursive constraints.
4. Starting a drag snapshots the rendered allocations. Movement distributes
   delta across the eligible panes on each side of the separator according to
   their available grow/shrink capacity and never mutates canonical state.
5. Separators live in an absolute overlay, centred on the top edge of each
   non-first visible pane title. They have a compact visual rule and a reliable
   hit target, and consume no layout pixels.
6. Preferred dimensions remain keyed by pane id. Temporary normalization does
   not rewrite them. A successful user resize updates every affected preference
   together; cancellation restores the snapshot.
7. A completed vertical resize submits one project sidebar patch containing all
   changed pane dimensions. A completed width resize likewise submits once.
   Snapshot reconciliation cannot replace the live preview or regress a newer
   commit.

## Delivery record

### 1. Pure geometry and state model

- Define explicit pane input, rendered allocation, separator constraint, and
  resize-session types outside React rendering.
- Implement a pure normalizer that uses actual title heights and produces
  finite, non-negative pixel allocations whose sum equals the container height.
- Implement drag-delta distribution across all eligible panes above and below a
  boundary. Define stable distribution order and rounding so repeated layout
  does not drift by pixels.
- Preserve per-id preferred sizes across reordering, collapse/expand cycles,
  temporary container shrinkage, and changes to the registered pane set.
- Define the supported-host minimum-height invariant and make an impossible
  title budget explicit rather than relying on overflow or clipped content.

Milestone gate: focused unit tests cover empty/one/many panes, all collapse
combinations, exact-fit and constrained containers, every separator, extreme
deltas, fractional measurements, reorder, pane registration changes, last-pane
preferences, shrink/regrow restoration, and solver idempotence.

### 2. Flat stack and VS Code-style separators

- Replace the recursive `SidebarSplit` rendering in `SidebarPanelStack` with the
  flat controller. Remove obsolete recursive constraint code once no caller
  depends on it.
- Measure title rows through stable refs/observation and relayout when their
  rendered height changes. Avoid a measurement/render feedback loop.
- Keep the stack and pane wrappers `overflow: hidden`; preserve the existing
  internal scrolling behavior of each pane body.
- Render absolute separators centred at the top edge of the following title.
  Give them directional min/max states, correct resize cursors, and a hit target
  that does not obstruct title controls.
- Use pointer capture and document/window completion safeguards. Prevent text
  selection during drag and clean up listeners, capture, and transient styles
  after pointer-up, cancellation, lost capture, and unmount.
- Add Arrow Up/Down and Home/End behavior plus complete separator ARIA values.
  Pointer and keyboard input must call the same geometry operations.

Milestone gate: component interaction tests perform repeated upward and
downward drags, reach both limits, resize every separator, cancel a drag, resize
after reorder/collapse/window changes, and verify title/body/handle bounding
boxes and keyboard semantics.

### 3. Preview, commit, and snapshot reconciliation

- Split transient preview callbacks from canonical commit callbacks. Do not
  route pointer movement through `useProjectCollection.updateProject` or
  `WorkspaceSnapshotStore.updateProjectSidebar`.
- Keep the active preview local to the mounted project presentation. On
  completion, calculate one bounded sidebar patch for all affected pane ids and
  submit it once. On cancellation, submit nothing.
- Reconcile canonical snapshots received during an interaction without
  replacing its preview. After completion, accept the authoritative result
  while rejecting or ordering stale responses so an older height cannot snap
  back over the committed one.
- Connect `WorkspaceSplitLayout`'s existing navigation-width preview and commit
  separation in `App`; width pointer movement must not persist on every event.
- Preserve project independence and Settings-as-new-project-default behavior.
  Do not add renderer persistence or global sidebar defaults as a write target.
- Make failures bounded and recoverable: retain the last authoritative state,
  end the interaction cleanly, expose the existing operation failure path, and
  permit a subsequent resize.

Milestone gate: integration tests count workspace calls and prove zero writes
during movement, one write on completion, zero on cancellation, one width write,
ordered snapshot reconciliation, recoverable failure, and no writes to another
project or Settings defaults.

### 4. End-to-end acceptance and cleanup

- Add Docker Electron E2E that resizes every boundary from the top of the
  following title, performs several consecutive drags, and verifies live motion
  rather than only final serialized values.
- At multiple supported window heights, assert every visible title lies inside
  the sidebar, the outer stack has no vertical scroll range, and overflowing
  content scrolls within its own pane.
- Cover collapse/expand, all supported pane orders, project switching between
  different layouts, window shrink/regrow, reload, restart/hydration, and a
  second presentation receiving the committed state.
- Record/count `project.sidebar.update` commands during a drag so pointer-event
  command flooding cannot regress silently.
- Remove or replace source-regex tests that claim resizing works without
  exercising geometry. Update any persistence tests that still expect project
  interaction to rewrite global Settings defaults.
- Check the sidebar-width interaction for the same command-count and persistence
  guarantees.

Milestone gate: focused tests, application build, lint, and the relevant Docker
Electron E2E pass with no flaky pointer timing or pixel assertions.

## Required verification

At minimum, add focused solver and component tests plus a dedicated E2E spec,
then run:

```sh
npm run lint
npm run build:app
npm run test:e2e
```

Electron E2E must run through `npm run test:e2e`, which isolates Electron,
Chromium, and Xvfb in Docker. Do not run the Playwright Electron suite directly
on the host or use `npm run test:e2e:host`.

## Do not ship these shortcuts

- A debounce around the existing per-pointer durable update while retaining the
  recursive layout model.
- Independent nested split clamps or an approximate global header constant.
- An outer sidebar scrollbar, clipped/off-screen titles, or automatic loss of a
  saved preference merely to make the layout fit temporarily.
- A separator that consumes layout height or remains visually enabled when it
  cannot move.
- Persisting each affected pane in separate workspace commands.
- Source-pattern assertions as the primary evidence for resize behavior.
- Copying VS Code's full SplitView framework or adding unrelated workbench
  abstractions.

## Acceptance checks

- [x] Every visible pane title remains completely on-screen throughout all
  supported layout interactions and window sizes.
- [x] The outer sidebar never scrolls vertically; each overflowing pane body
  scrolls independently.
- [x] Separators overlay the top edge of the following title and remain usable
  through repeated bidirectional pointer and keyboard resizing.
- [x] All pane preferences, including the final pane, survive reorder,
  collapse/expand, shrink/regrow, project switching, and restoration.
- [x] Pointer movement sends no workspace update; successful completion sends
  exactly one atomic project update; cancellation sends none.
- [x] Sidebar width obeys the same preview/commit command-count contract.
- [x] A restart/reload/reconnect restores only committed project-local state and
  never changes another project or global defaults.
- [x] Solver, component, integration, accessibility, and Docker Electron E2E
  coverage exercise the actual geometry and persistence boundary.

## Definition of done

The recursive layout and per-movement persistence paths are gone. The flat
solver satisfies the governing feature in desktop and web presentations, every
acceptance check passes, and this file is retained in `../tasks_completed/` as
implementation history.

## Completion evidence

- Focused sidebar-layout verification passed: 24 tests.
- `npm run build:app` passed.
- `npm run test:e2e` passed in Docker: 246/246 tests.
- Lint of changed files is clean. The full-repository lint command continues to
  report pre-existing, unrelated diagnostics outside this task's changed files.
