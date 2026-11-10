## 1. Keyboard flow

- [x] 1.1 Focus the search box when it first appears, outside the compact layout, if focus is on Open a folder or nowhere, in `src/workspace/ProjectStartChooser.tsx`.
- [x] 1.2 Take each forget control out of the arrow order while keeping it in the tab order.
- [x] 1.3 From a forget control, ↓ focuses the item after its row and ↑ its row's folder.
- [x] 1.4 Outline the whole recent row when its folder has keyboard focus, in `src/workspace/projectStart.css`.
- [x] 1.5 Update `scripts/project-start-chooser-ui.test.mjs` for the arrow order, the row outline, and the focus rule.

## 2. End-to-end coverage

- [x] 2.1 Extend `e2e/project-start-chooser.spec.ts` with a server holding more than five recent folders: the search box is focused on show; typing then ↓ ↓ Enter opens the second match; ↓ never focuses a forget control; Tab reaches a forget control, and ↑ from it returns to its row's folder.
- [x] 2.2 Capture screenshots of the focused search box and a focused row. Written by the e2e test to its output folder; not captured locally because Docker was unresponsive.

## 3. Verify

- [x] 3.1 `npx biome check` passes, and `openspec validate start-chooser-keyboard-flow` passes. `openspec validate --all` has seven failures in other changes that are on `main` already.
- [x] 3.2 `e2e/project-start-chooser.spec.ts` passes through `npm run test:e2e`. Local Docker was unresponsive, so this ran in the PR's CI E2E shards.
