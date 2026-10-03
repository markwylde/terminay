## 1. Drop eligibility

- [x] 1.1 Add a pure function beside `panelMoveTargets` in `src/workspace/projectTabComposition.ts` that, given the dragged terminal's source project, the project list, and a candidate tab, returns whether that tab accepts the drop: in `panelMoveTargets`, ready (`creationStatus === undefined`), and not inert. Verified by a `node --test` suite in `scripts/` asserting it accepts a same-server sibling and rejects the source project, another server's project with the same project id, a pending tab, a failed tab, and an inert tab.
- [x] 1.2 Assert in that suite that the accepted set equals the ids `getProjectsForTerminalMove` would offer for the same inputs, so the menu and the drop targets cannot drift. Verified by that assertion passing.

## 2. Reporting the dragged terminal to the shell

- [x] 2.1 In `src/workspace/useTerminalDockviewWindowController.ts`, have the main-window `dragstart`/`dragend` handlers report the drag upward through a new optional callback: `{ panelId }` at start only when the dragged item is a single panel whose tab component is `terminalTab`, and `null` at end. Group drags and popout-window drags report nothing. Verified by `npm run typecheck:workspaces` and by a source-shape assertion in `scripts/terminal-tab-project-drop.test.mjs` that the report is gated on the main window, a panel id, and the `terminalTab` component.
- [x] 2.2 In `src/App.tsx`, thread that callback from the project workspace to the shell, recording `{ sourceProjectId, panelId }` in a ref and exposing whether a terminal drag is in progress. Clear it on drag end. Verified by `npm run typecheck:workspaces`.

## 3. Project tabs as drop targets

- [x] 3.1 Add optional `terminalDropTargetIds` (the handles that accept the current drag) and `onTerminalDrop(handle)` props to `ProjectTabList`, and on each visible `Reorder.Item` add `dragenter`/`dragover`/`dragleave`/`drop` handlers that call `preventDefault()` only for handles in that set, track the hovered handle, ignore `dragleave` into the tab's own children, and on `drop` call `stopPropagation()`, clear the hover, and invoke `onTerminalDrop`. Handlers must not call `onActivate`. Verified by a `node --test` source-shape suite in `scripts/` asserting the handlers exist on the visible tab only, are gated on the set, and that the overflowed and placeholder elements carry none.
- [x] 3.2 In `src/App.tsx`, compute `terminalDropTargetIds` from the drag record with the function from 1.1, and implement `onTerminalDrop` by resolving the handle to its project id and recording it as the drop target, so the drag-end report calls the existing `moveTerminalToProject(sourceProjectId, panelId, targetProjectId)` once the dragged tab is no longer in flight. Verified by a source-shape assertion that the drop path calls `moveTerminalToProject` and introduces no second export/adopt call, and by `npm run typecheck:workspaces`.
- [x] 3.3 Style `project-tab--terminal-drop-target` from the tab's `--project-color` in the project bar stylesheet, and confirm the full tab box is `-webkit-app-region: no-drag` so drag events reach it in Desktop. Verified by `npm run lint` and by the e2e affordance assertion in 5.1.

## 4. Not disturbing neighbouring drags

- [x] 4.1 Confirm a drop on a project tab does not also trigger the popout-on-drag-out path, and that dragging a terminal tab across the project bar neither activates nor reorders a project tab. Verified by the e2e assertions in 5.1 and 5.3 (window count unchanged; active project and tab order unchanged after a rejected drop).

## 5. End-to-end coverage

- [x] 5.1 Add an e2e case in `e2e/terminal.spec.ts`: create a second project, return to the first, drag the terminal tab onto the second project's tab with stepped mouse moves, assert the target tab carries `project-tab--terminal-drop-target` before release, then assert after release that the second project is active, the terminal is there, and exactly one window exists. Verified by that case passing under `npm run test:e2e`.
- [x] 5.2 Add an e2e case that writes a marker line, moves the terminal by drop, and asserts the same session id and the marker are present in the target project, mirroring the existing scrollback case for the context menu. Verified by that case passing under `npm run test:e2e`.
- [x] 5.3 Add an e2e case that releases a terminal tab on its own project's tab and on the Home control, asserting no affordance appears, the terminal count per project is unchanged, and the active project and tab order are unchanged. Verified by that case passing under `npm run test:e2e`.

## 6. Checks and delivery

- [x] 6.1 Run `openspec validate --all`, `npm run lint`, `npm run typecheck:workspaces`, and the touched `node --test` suites. Verified by all four reporting clean.
- [ ] 6.2 Open the pull request on Gitea with `tea`, then read back every commit status on the head SHA and confirm each is `success` or `skipped`. Verified by the status listing itself.
