## 1. Default view and fallback

- [x] 1.1 Change the catalog's `preferredMode` to: binary → Preview when safe, else HEX; safe Markdown → Preview; other text, including content-recognised text → Text. Widen the text extension table. Verified by `node --test packages/server-core/test/file-catalog.test.mjs` asserting unknown-extension text prefers Text.
- [x] 1.2 Derive `primaryModes`, `secondaryModes`, `defaultMode`, and `fallbackMode = defaultMode` in `src/services/fileViewer/capabilities.ts`. Verified by `node --test --experimental-strip-types scripts/file-viewer-view-modes.test.mjs` covering source, content-recognised text, Markdown, image, binary, and the unavailable-view fallback.
- [x] 1.3 Resolve a custom extension default through the same availability check. Verified by `npx tsc --noEmit -p tsconfig.json` and the custom-extension case in `e2e/file-viewer-core.spec.ts`.

## 2. View switcher and panel chrome

- [x] 2.1 Rebuild `FileModeSwitcher` as a tab row with a More views menu and per-view disabled reasons; wire it in `FilePanel` with the Diff reason and an inline notice when Diff was requested. Verified by the "opened for a diff it does not have" and "unknown extensions" cases in `e2e/file-viewer-core.spec.ts`.
- [x] 2.2 Restyle the toolbar and switcher in `fileViewer.css` to the dock tab metrics and the tab's own colour. Verified by `npm run lint` and by viewing the panel in the running app.
- [x] 2.3 Give the Monaco theme the panel surface and the Preview palette, and the editor Preview's type metrics. Verified by viewing Preview and Text of one file side by side in the running app.
- [x] 2.4 Delete `FileStatusBar`; expose `data-dirty` and `data-engine` on the panel root; show Invalid HEX in the toolbar. Verified by `grep -r file-status-bar src` returning nothing and the migrated e2e assertions passing.

## 3. Window status bar

- [x] 3.1 Add `formatStatusBarFileSize`, `useFocusedFileStatus`, and `FocusedFileSummary`; render the file summary in place of the terminal summary when a file panel is active. Verified by the size cases in `scripts/file-viewer-view-modes.test.mjs`, by `node --test scripts/workspace-status-bar.test.mjs` (no `setInterval`), and by an e2e assertion on `workspace-status-bar-file`.

## 4. Tests and checks

- [x] 4.1 Migrate e2e specs that asserted on `.file-status-bar` or assumed Preview for text; add `selectFileView` to `e2e/support/ui.ts`. Verified by the touched specs passing under `npm run test:e2e`.
- [x] 4.2 Run `openspec validate --all`, `npm run lint`, `npm run typecheck:workspaces`, and the touched `node --test` suites. Verified by all reporting clean.
- [ ] 4.3 Open the pull request on Gitea with `tea`, then read back every commit status on the head SHA and confirm each is `success` or `skipped`. Verified by the status listing itself.
