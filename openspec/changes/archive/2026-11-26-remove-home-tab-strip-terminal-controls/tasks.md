## 1. Scope terminal-creation controls to project tab strips

- [x] 1.1 In `src/workspace/useTerminalDockviewWindowController.ts`, make `ensureHeaderButtons` skip `.dv-void-container` elements inside `[data-terminay-home-tabs]`, with a comment naming the retained limitation from design.md. Verify: `timeout 600 npx tsc --noEmit -p tsconfig.json` and `npx biome lint src/workspace/useTerminalDockviewWindowController.ts` pass.
- [x] 1.2 Make the header click, double-click and context-menu handlers ignore targets inside `[data-terminay-home-tabs]`, so Home's strip never creates a terminal or opens the profile chooser. Verify: the E2E in 2.1.

## 2. Tests

- [x] 2.1 Extend `e2e/home-tabs.spec.ts`. On Home, after waiting past a header reconciliation tick (> 500 ms), Home's tab strip has no New terminal tab or New terminal with profile control, including after arranging two Home tabs side by side. Double-clicking Home's empty strip, then waiting past reconciliation, leaves the terminal count across all projects unchanged; right-clicking Home's strip opens no profile chooser. On a project, its panel tab strip shows both controls and New terminal tab creates a terminal. (Project double-click and chooser behaviour are otherwise unchanged code paths.) Verify: `timeout 1800 npm run test:e2e -- e2e/home-tabs.spec.ts` passes in Docker.
- [x] 2.2 Capture screenshots of Home's tab strip and a project's tab strip for the PR. Verify: files exist under the scratchpad `screenshots/` folder.
- [x] 2.3 Run `openspec validate remove-home-tab-strip-terminal-controls` and `openspec validate --all`. Verify: this change validates; any `--all` failure is confirmed to pre-exist on `main` and is recorded in the PR, not introduced here.
