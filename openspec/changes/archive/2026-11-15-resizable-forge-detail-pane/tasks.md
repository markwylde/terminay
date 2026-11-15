## 1. Width model

- [x] 1.1 Add `forgeDetail` (default 380) to the device column-width store in `src/workspace/localViewState.ts`. Verify: `scripts/local-view-state.test.mjs` recalls 380 by default and remembers a set width, rounded, without touching the other columns (the relaunch scenario).
- [x] 1.2 Keep every `useRememberedColumnWidth` reader of one column in one window in step on commit. Verify: type-check passes and the E2E step in 3.3 shows Issues drawing the width chosen in Pull Requests.
- [x] 1.3 Add `forgeDetailWidthBounds`, `drawnForgeDetailWidth` and `forgeDetailLayout` to `src/forge/forgeModel.ts` (280 minimum, 720 maximum, list keeps 320, stacked below 600). Verify: `src/forge/forgeModel.test.ts` covers the default, both bounds, a narrow grid, shrink and regrow, an out-of-range stored width, an unmeasured grid, and the stacking threshold.

## 2. Separator

- [x] 2.1 Add `src/forge/ForgeDetailSeparator.tsx`: a focusable vertical separator with aria values; drag with live preview, commit on release only after movement, nothing on cancel, blur, or unmount; Arrow Left/Right by 16 pixels, clamped. Verify: `scripts/forge-ui.test.mjs` renders it with the given `aria-valuenow`, bounds and `tabindex`; the gestures by the E2E step in 3.3.
- [x] 2.2 In `ForgeHomeSection`, measure the grid, draw the detail column at the drawn width, and render the separator only when a detail is shown side by side; add a stacked class when the grid is narrower than 600 pixels. Verify: the E2E step in 3.3 sees the separator with a detail, none without one, and none in a narrow Home tab.
- [x] 2.3 Style the separator like the workflow separator, keep the 900-pixel viewport rule, and stack and hide it under the stacked class. Verify: the E2E screenshots and the narrow-tab check in 3.3.

## 3. Verification

- [x] 3.1 Renderer type-check (`npx tsc -p tsconfig.json --noEmit`) and `npx biome lint` on changed files. Verify: no errors.
- [x] 3.2 `npm run test:forge-ui` and `npm run test:local-view-state`. Verify: pass.
- [x] 3.3 Extend `e2e/forge-pull-requests-and-issues.spec.ts`: the preview starts at 380; dragging 100 pixels left gives 480, with a live width during the drag; a press without a move changes nothing; a drag ended by `pointercancel` restores 480; Arrow Left twice and Arrow Right once gives 496; the remembered width is in the device store; Issues draws the same width; a Home narrowed below 600 pixels stacks the preview with no separator; screenshots of the default, widened, and stacked states. Verify: `npm run test:e2e` for that spec passes.
- [x] 3.4 `openspec validate --all`. Verify: this change validates; any failures already on `main` in other changes are listed and left alone.
