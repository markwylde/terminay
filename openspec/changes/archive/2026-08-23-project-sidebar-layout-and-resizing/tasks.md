## 1. Pure geometry and state model

- [x] 1.1 Define explicit pane input, rendered allocation, separator constraint, and resize-session types outside React rendering, verified by type-level and unit coverage.
- [x] 1.2 Implement a pure normalizer using actual title heights that produces finite, non-negative allocations summing to the container height, verified by unit tests over empty, one, and many panes and exact-fit and constrained containers.
- [x] 1.3 Implement drag-delta distribution across all eligible panes above and below a boundary with stable distribution order and rounding, verified by repeated-layout tests proving no pixel drift.
- [x] 1.4 Preserve per-id preferred sizes across reordering, collapse/expand cycles, temporary container shrinkage, and registered-pane-set changes, verified by preference-retention tests.
- [x] 1.5 Define the supported-host minimum-height invariant and make an impossible title budget explicit, verified by tests asserting an explicit result rather than overflow or clipping.
- [x] 1.6 Milestone gate: focused unit tests cover empty/one/many panes, all collapse combinations, exact-fit and constrained containers, every separator, extreme deltas, fractional measurements, reorder, pane registration changes, last-pane preferences, shrink/regrow restoration, and solver idempotence.

## 2. Flat stack and separators

- [x] 2.1 Replace recursive `SidebarSplit` rendering in `SidebarPanelStack` with the flat controller and remove the obsolete recursive constraint code, verified by the absence of the recursive path and by component tests.
- [x] 2.2 Measure title rows through stable refs and observation and relayout on rendered height changes without a measurement/render feedback loop, verified by measurement tests.
- [x] 2.3 Keep the stack and pane wrappers `overflow: hidden` while preserving each pane body's internal scrolling, verified by scroll-range assertions.
- [x] 2.4 Render absolute separators centred at the top edge of the following title with directional min/max states, correct resize cursors, and a hit target that does not obstruct title controls, verified by bounding-box tests.
- [x] 2.5 Use pointer capture with document/window completion safeguards, prevent text selection during drag, and clean up listeners, capture, and transient styles after pointer-up, cancellation, lost capture, and unmount, verified by interaction teardown tests.
- [x] 2.6 Add Arrow Up/Down and Home/End behaviour plus complete separator ARIA values driving the same geometry operations as pointer input, verified by keyboard and accessibility tests.
- [x] 2.7 Milestone gate: component interaction tests perform repeated upward and downward drags, reach both limits, resize every separator, cancel a drag, resize after reorder/collapse/window changes, and verify title/body/handle bounding boxes and keyboard semantics.

## 3. Preview, commit, and snapshot reconciliation

- [x] 3.1 Split transient preview callbacks from canonical commit callbacks so pointer movement does not route through `useProjectCollection.updateProject` or `WorkspaceSnapshotStore.updateProjectSidebar`, verified by workspace call counts.
- [x] 3.2 Keep the active preview local to the mounted project presentation, submit one bounded sidebar patch for all affected pane ids on completion, and submit nothing on cancellation, verified by command-count tests.
- [x] 3.3 Reconcile canonical snapshots received during an interaction without replacing the preview, and reject or order stale responses so an older height cannot snap back over the committed one, verified by ordered-reconciliation tests.
- [x] 3.4 Connect `WorkspaceSplitLayout`'s navigation-width preview and commit separation in `App` so width pointer movement does not persist on every event, verified by a single width write per completed resize.
- [x] 3.5 Preserve project independence and Settings-as-new-project-default behaviour without adding renderer persistence or global sidebar defaults as a write target, verified by tests asserting no writes to another project or to Settings defaults.
- [x] 3.6 Make failures bounded and recoverable by retaining the last authoritative state, ending the interaction cleanly, exposing the existing operation failure path, and permitting a subsequent resize, verified by failure-path tests.
- [x] 3.7 Milestone gate: integration tests count workspace calls and prove zero writes during movement, one write on completion, zero on cancellation, one width write, ordered snapshot reconciliation, recoverable failure, and no writes to another project or Settings defaults.

## 4. End-to-end acceptance and cleanup

- [x] 4.1 Add Docker Electron E2E that resizes every boundary from the top of the following title, performs several consecutive drags, and verifies live motion rather than only final serialized values.
- [x] 4.2 At multiple supported window heights, assert every visible title lies inside the sidebar, the outer stack has no vertical scroll range, and overflowing content scrolls within its own pane.
- [x] 4.3 Cover collapse/expand, all supported pane orders, project switching between different layouts, window shrink/regrow, reload, restart/hydration, and a second presentation receiving the committed state.
- [x] 4.4 Record and count `project.sidebar.update` commands during a drag so pointer-event command flooding cannot regress silently.
- [x] 4.5 Remove or replace source-regex tests that claim resizing works without exercising geometry, and update persistence tests that expected project interaction to rewrite global Settings defaults.
- [x] 4.6 Check the sidebar-width interaction for the same command-count and persistence guarantees.
- [x] 4.7 Milestone gate: focused sidebar-layout verification passed with 24 tests, `npm run build:app` passed, and `npm run test:e2e` passed in Docker with 246/246 tests. Lint of changed files is clean; the full-repository lint command continues to report pre-existing, unrelated diagnostics outside this change's files.
