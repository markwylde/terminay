## 1. Switcher model lists every panel

- [x] 1.1 Extend `compactSwitcherModel.ts` so each project group carries every terminal, file, and folder panel as a row with `panelKind`, keeping terminal preview and activity as they are. Verified by `node --test scripts/compact-switcher-model.test.mjs` asserting a project with mixed panel kinds lists all three, and that filter matches file and folder titles.

## 2. Close controls on the switcher

- [x] 2.1 Render each panel as a row container with the existing activate/long-press target and a sibling close control whose accessible name includes the panel title; render a close control on each project heading next to the new-terminal `+`. Verified by `node --test scripts/compact-switcher-ui.test.mjs` asserting those controls exist, are not nested buttons, and that a close click is bound separately from activate.
- [x] 2.2 Style the close control to match the per-project `+` (28px target) without overflowing a 320px sheet. Verified by the same UI suite still asserting row structure, and by `npm run lint`.
- [x] 2.3 Wire `onClosePanel` and `onCloseProject` in `src/App.tsx`: terminals dispatch `terminay-request-close-terminal` with panel and session ids; files and folders dispatch `terminay-request-close-file` with the panel id; projects call `closeComposedTab`. Keep the switcher open. Verified by a source-shape assertion in `scripts/compact-switcher-ui.test.mjs` that those handlers use the existing events/`closeComposedTab` rather than a second close implementation, and by `npm run typecheck:workspaces`.

## 3. End-to-end coverage

- [x] 3.1 Add an e2e case at compact width that opens the switcher, closes one terminal of a project that has more than one, and asserts that terminal is gone while the switcher stays open and a sibling terminal remains. Verified by that case passing under `npm run test:e2e`.
- [x] 3.2 Add an e2e case at compact width that closes a project from its switcher heading and asserts that project is gone. Verified by that case passing under `npm run test:e2e`.

## 4. Specs and checks

- [x] 4.1 Run `openspec validate --all` and `npm run lint`, `npm run typecheck:workspaces`, and the touched `node --test` suites. Verified by all four reporting clean.
- [ ] 4.2 Open the pull request on Gitea with `tea`, then read back every commit status on the head SHA and confirm each is `success` or `skipped` before calling it green. Verified by the status listing itself.
