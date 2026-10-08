## 1. Reproduction

- [x] 1.1 Keep the two end-to-end tests already in `e2e/project-tabs.spec.ts` ("a project dragged out and back in can be dragged out again", "a second project can be dragged out after the first") with the `setCursorScreenPoint` / `tabBarScreenPoints` / `tearOffProjectTab` helpers. Verified by: `npm run test:e2e -- e2e/project-tabs.spec.ts -g "dragged out"` fails on both before any product change, at the tear-off after the first.
- [x] 1.2 Make the second-tear-off test wait for the first new window before starting the second drag, and assert two distinct new windows exist. Verified by: the test still fails before the fix and its failure is the missing drag ghost, not a timing error.

## 2. Host: every drag session announces its end

- [x] 2.1 In `electron/main.ts`, funnel `endCanonicalProjectDrag` and `stopProjectDragTracking` through one teardown that calls `setProjectTabTornOff(false)` while the source id is known, then clears the poll timer, ghost window, source id, and preview. Verified by: the tests from 1.1 pass with only this change applied.

## 3. Renderer: torn-off lasts one drag

- [x] 3.1 In `src/workspace/useProjectTabTransfer.ts`, clear `isDraggingTabTornOff` in `handleProjectTabDragStart` and when `handleProjectTabDragEnd` settles. Verified by: with task 2.1 temporarily reverted, the tests from 1.1 pass on this change alone; then restore 2.1.
- [x] 3.2 Clamp the preview width sent to `beginWorkspaceDrag` to 80–2000. Verified by: a unit test of the width helper covering 0, 79, 80, 2000, and 2001.
- [x] 3.3 Handle a rejected `beginWorkspaceDrag`: record the failure and reset `nativeDragStartedRef` so release is a plain reorder. Verified by: a unit or component test in which the host bridge rejects the start asserts one diagnostic and no `workspace.drag.end` request.

## 4. Coverage

- [x] 4.1 Add an end-to-end test that reorders a tab along the strip in a window that was previously a tear-off source and asserts the dragged tab never carries `project-tab--torn-off`. Verified by: the test fails with tasks 2.1 and 3.1 reverted and passes with them applied.
- [x] 4.2 Establish whether a bar layout can display a project tab narrower than 80px; if it can, add an end-to-end test that tears one off. Verified by: either the test fails with task 3.2 reverted and passes with it applied, or the measured minimum tab width is recorded in the pull request and the unit test from 3.2 stands alone.
- [x] 4.3 Run the whole project-tabs spec. Verified by: `npm run test:e2e -- e2e/project-tabs.spec.ts` reports every test passed.

## 5. Drop into another window lands at the pointer

- [x] 5.1 Protocol: add required `projectId` to `workspace.drag.start` and the `workspace.drop-target` event (`phase`, `x`, `serverId`, `projectId`, `title`, `emoji`, `color`) to `packages/protocol/src/host.ts`. Verified by: `packages/protocol/test/host.test.mjs` accepts the new shapes and rejects an unknown phase, a non-integer x, and a missing `projectId`.
- [x] 5.2 Host: while torn off, publish `hover` (on entry and on every x change) and `leave` to the window whose bar the cursor is over, hide the ghost while hovering, publish `drop` and focus that window on release, and publish `leave` when a session ends without a drop. Verified by: the end-to-end tests in 5.5.
- [x] 5.3 Pure placement helpers: the insertion point for an x over a strip, and a composition order with one tab inserted before another. Verified by: unit tests covering before-first, between, after-last, an absent anchor, and a tab already in the order.
- [x] 5.4 Renderer: subscribe to `workspace.drop-target`; show the placeholder on hover; on drop hold the placement until the project arrives, then write the order, commit it, activate the tab, and clear; forget a drop after ten seconds. Verified by: the end-to-end tests in 5.5.
- [x] 5.5 End-to-end: holding a torn-off tab over the other window's bar shows the placeholder there and hides it on leaving; dropping right of every tab makes it the last tab and active; dropping left of the first tab makes it the first tab and active. Verified by: the tests fail before 5.2 and 5.4 and pass after.

## 6. Finish

- [x] 6.1 Validate the change. Verified by: `openspec validate --all` exits 0.
- [x] 6.2 Open the pull request on `origin` (Gitea) and read back its commit statuses. Verified by: every status on the head SHA is `success` or `skipped`.
