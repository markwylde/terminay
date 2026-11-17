## 1. Shared pane separator

- [x] 1.1 Move `src/forge/ForgeDetailSeparator.tsx` to `src/components/PaneEdgeSeparator.tsx` with `label`, `step`, `className`, and pass-through `data-*` props; gesture code unchanged. Update `ForgeHome.tsx` to use it with `forge-home__separator`, `data-forge-detail-separator`, label "Resize preview", and `FORGE_DETAIL_RESIZE_STEP`. Verified by `npm run typecheck:workspaces` and `npx tsc --noEmit -p tsconfig.json`.
- [x] 1.2 Update `scripts/forge-ui.test.mjs` to bundle `src/components/PaneEdgeSeparator.tsx` and render `PaneEdgeSeparator` with the Forge props. Verified by `npm run test:forge-ui`.
- [x] 1.3 Move the separator's line, hover, focus, and reduced-motion styling into a shared `.pane-edge-separator` class in `src/components/paneEdgeSeparator.css`, imported by the component, keeping only Forge's positioning in `forge.css`. Verified by the Forge and Bots E2E screenshots looking alike.

- [x] 1.4 Replace the workflow panel's own `WorkflowPanelSeparator` with `PaneEdgeSeparator` (`workflow-panel-separator`, "Resize workflow panel", `WORKFLOW_PANEL_RESIZE_STEP`, commit through `setWorkflowPanelWidth`), keeping only its positioning in `WorkflowPanel.css`, and loosen the `scripts/workflow-ui.test.mjs` class match. Verified by `npm run test:workflow-ui` and `npm run test:e2e -- e2e/workflow-panel-width.spec.ts e2e/workflows-narrow.spec.ts`.

## 2. Device-remembered width

- [x] 2.1 Add `botsRail` (default 300) to `ResizableColumn` and `DEFAULT_COLUMN_WIDTHS` in `src/workspace/localViewState.ts`. Verified by new cases in `scripts/local-view-state.test.mjs`: default 300, a round trip, and the value surviving a fresh module load (relaunch).
- [x] 2.2 Add `src/workspace/bots/botsRailWidth.ts` with the 240/560/420 constants, a 16-pixel step, `botsRailWidthBounds`, `drawnBotsRailWidth`, and `botsRailResizable(rowWidth, narrowWindow)`, plus a `useBotsRailWidth()` hook (row measurement, live preview, narrow-window media query). Verified by `src/workspace/bots/botsRailWidth.test.ts` covering bounds, room for the main column, shrink-then-grow returning to the chosen width, out-of-range remembered widths, an unmeasured row, and the 660-pixel and narrow-window cut-offs, wired into `test:workspace-models`.

## 3. Bots wiring

- [x] 3.1 In `BotsSection.tsx` and `BotChat.tsx`, set `--bots-rail-width` on the row, and render a `PaneEdgeSeparator` (`bots-rail__separator`, `data-bots-rail-separator`, label "Resize rail") before the rail only when resizable. `.bots-rail` uses the custom property; the existing narrow-window CSS (stack on the overview, hide in Chat) keeps full width or hidden. Verified by the E2E steps in 4.1.

## 4. Verification

- [x] 4.1 Extend `e2e/bots.spec.ts`: on the overview, drag the rail separator 100 pixels left (300 → 400) with nothing stored until release; press without move changes nothing; keyboard Left, Left, Right (+16); open a bot tab and see its context rail at the same width with a separator; resize the window to 800 pixels and see no separator on either surface, then back and see the chosen width restored; a cancelled drag returns to its width; a 600-pixel Chat area draws 240 pixels with no separator and restores the choice; capture screenshots. Verified by `npm run test:e2e -- e2e/bots.spec.ts`.
- [x] 4.2 Re-run the Forge separator E2E coverage with `npm run test:e2e -- e2e/forge-pull-requests-and-issues.spec.ts`, passing.
- [x] 4.3 Run `npm run lint`, `npm run typecheck:workspaces`, `npm run test:local-view-state`, `npm run test:workspace-models`, and `openspec validate --all`, all passing (`--all` reports only failures already present on main in other changes; this change validates).
