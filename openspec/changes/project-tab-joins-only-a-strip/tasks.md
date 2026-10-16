## 1. Tab shape

- [x] 1.1 In `src/App.css`, give the active project tab's surface the closed, inset shape while the active workspace is the start chooser. Verify: the chooser shows a rounded pill; a started project's tab joins its panel tab strip.

- [x] 1.2 In `RootFolderBrowser`, stop a landing listing from overwriting a path typed while it loaded. Verify: the start chooser E2E cases that type a path pass.

## 2. Verification

- [x] 2.1 Add an E2E case in `e2e/project-start-chooser.spec.ts` asserting the tab surface does not overhang the bar on the chooser and does once the project starts. Verify: passes in CI.
- [x] 2.2 Run `openspec validate --all` and lint. Verify: both pass.
