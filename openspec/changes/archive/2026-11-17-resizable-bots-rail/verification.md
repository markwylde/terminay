# Verification — resizable-bots-rail

- Tasks: 12/12 complete.
- After moving the workflow panel onto the shared separator: `npm run test:workflow-ui` passed, and `npm run test:e2e` over the Bots rail, Forge, `workflow-panel-width`, and `workflows-narrow` specs: 7 passed.
- `npm run test:e2e -- e2e/bots.spec.ts e2e/forge-pull-requests-and-issues.spec.ts`: 38 passed (Docker), including the new Bots rail test and the existing Forge preview separator step.
- `npm run test:e2e -- e2e/bots.spec.ts -g "Bots rail"` after adding the cancel and narrow-area checks: 1 passed.
- `npm run test:workspace-models` (includes `test:forge-ui` and `botsRailWidth.test.ts`), `npm run test:local-view-state`, `npm run lint`, `npm run typecheck:workspaces`, and root `tsc --noEmit`: passing.
- `openspec validate resizable-bots-rail`: valid. `openspec validate --all` reports only failures already present on main in other active changes.

| Requirement | Evidence |
| --- | --- |
| Resizable Bots rail | `src/components/PaneEdgeSeparator.tsx`, `src/workspace/bots/BotsRailSeparator.tsx`; E2E drag, preview-before-commit, press without move, cancel |
| Bots rail width from the keyboard | `PaneEdgeSeparator` arrow keys with `BOTS_RAIL_RESIZE_STEP`; E2E Left, Left, Right → +16 |
| Bots rail width bounds | `src/workspace/bots/botsRailWidth.ts`; unit tests; E2E bounded drag and 600-pixel Chat area |
| Bots rail in a narrow window | `useBotsRailWidth` narrow-window query, existing `bots.css`/`botPanels.css` media queries; E2E at 800 pixels |
| Bots rail width is remembered on the device | `botsRail` column in `localViewState.ts`; unit relaunch test; E2E overview → Chat |
