## 1. Geometry model

- [x] 1.1 Create `src/shared/inPageWindow/geometry.ts` with `defaultRect`, `clampToViewport`, `rectAfterMove`, `rectForViewport`, and `fitRemembered`, enforcing the reachability rule (full title bar height and 160 px of width inside the viewport), the 480 × 320 minimum, and the viewport maximum. Verified by `src/shared/inPageWindow/geometry.test.ts` covering each rule, run with `node --test --experimental-strip-types`.
- [x] 1.2 Move the resize arithmetic and `ResizeEdges` from `src/workspace/appWindows/windowLayout.ts` into the shared model with minimums as arguments, and have `windowLayout.ts` call it. Verified by the existing `windowLayout.test.ts` passing unchanged and new resize cases in `geometry.test.ts` (opposite edge fixed, minimum, viewport maximum).
- [x] 1.3 Add `src/shared/inPageWindow/geometryStore.ts`: read and write `terminay.view.in-page-window.v1`, field-by-field validation, all storage access guarded. Verified by `geometryStore.test.ts` covering round-trip, malformed JSON, non-finite numbers, an unknown id, and a throwing or missing `localStorage`.
- [x] 1.4 Add the new test files to the `smoke` script in `package.json`. Verified by the three files appearing in the script and passing when run with its `node --test --experimental-strip-types` invocation.

## 2. The frame

- [x] 2.1 Build `InPageWindow.tsx` and `inPageWindow.css`: backdrop, frame, 36 px title bar with title and close button, body, CSS custom properties for the frame tokens, `data-connected-web-auxiliary-route` passthrough. Verified by `e2e/in-page-windows.spec.ts` asserting the dialog role and name, one heading, and one labelled close button.
- [x] 2.2 Add the window stack in `windowStack.ts`: only the topmost handles Escape, focus is held inside by guard elements, focus moves in on open and returns on close. Verified by `windowStack.test.ts` (close order, handled keys ignored) and by E2E: Tab never leaves the window, two nested windows close one per Escape, and focus returns to the opener.
- [x] 2.3 Add backdrop dismissal on a `pointerdown` whose target is the backdrop. Verified by E2E: a press on the backdrop closes, and a resize that ends over the backdrop does not.
- [x] 2.4 Add title bar movement with pointer capture and the 4 px threshold, writing `left`/`top` directly during the drag and committing on `pointerup`, reverting on `pointercancel`. Verified by an E2E drag asserting the new bounding box, drags past the top and right edges asserting the title bar stays reachable, and a drag across the About document.
- [x] 2.5 Add the eight resize handles for resizable kinds, with matching cursors. Verified by E2E drags of the right edge and the top-left corner asserting the fixed opposite edge, a drag past the minimum asserting 480 × 320, and the computed cursors.
- [x] 2.6 Add the maximise button and title bar double-click for resizable kinds, as a flag over the stored rect. Verified by E2E: maximise fills the viewport, a maximised window does not move, restore returns the previous bounding box, and About shows no maximise button and ignores a double-click.
- [x] 2.7 Wire the geometry store: restore through `fitRemembered` on open, write on `pointerup` and on maximise toggle. Verified by E2E: resize and move Settings, reload, reopen, assert the same bounding box; open Recordings and assert it is centred at its default; reopen in a smaller viewport and assert it fits; and a run with `localStorage` throwing.
- [x] 2.8 Add viewport observation: re-clamp on change without overwriting the user's rect, and render compact (fill viewport, no handles, no maximise, 44 px title bar) at the compact-chrome breakpoint. Verified by E2E: shrink the viewport and assert the window stays inside; set a phone viewport and assert fill and absence of the maximise button; widen again and assert the earlier bounding box returns.
- [x] 2.9 Add the open fade and remove it under `prefers-reduced-motion: reduce`. Verified by an E2E run with reduced motion emulated asserting the computed `animation-name` is `none`.
- [x] 2.10 Add the `busy` flag that disables close, Escape, and the backdrop. Verified by `scripts/web-auxiliary-presenter.test.mjs` asserting the frame guards its close path, and by 4.3.

## 3. Secondary routes

- [x] 3.1 Replace `ConnectedBrowserAuxiliaryDialog` with `InPageWindow` for Settings, Macros, Recordings, Remote Control, and Performance Log as resizable kinds with per-route default sizes taken from the former CSS widths. Verified by `scripts/web-auxiliary-presenter.test.mjs` and `scripts/web-auxiliary-route-controller.test.mjs` passing against the new presenter.
- [x] 3.2 Hide the heading that repeats the window title in Settings, Macros, Recordings, Remote Control, Performance Log, and the Edit Tab form with a rule scoped to the frame body, leaving Desktop's native windows unchanged. Verified by a screenshot of the real Edit Tab form in the frame showing one title, and by the rule living only under `.in-page-window__body`.
- [x] 3.3 Present Edit Tab and Edit Project through `InPageWindow` as content-sized, titled "Edit Terminal Tab" / "Edit Project Tab", with close wired to the existing cancel that resolves the pending edit with `null`. Verified by a screenshot of the real form in the frame, and by the Desktop E2E suites that open these editors (`project-tabs`, `home-tabs`, `shell-profiles`) in 5.4.
- [x] 3.4 Replace `ConnectedBrowserAboutDialog` with `InPageWindow` around the unchanged sandboxed iframe. Verified by the presenter test asserting the unchanged `sandbox` attribute, and by E2E: the title bar close button closes the About window and a title bar drag across the document moves it.
- [x] 3.5 Delete the now-unused `connected-web-auxiliary-*` and `connected-web-about-dialog*` rules. Verified by `grep` finding no remaining references and the presenter test asserting their absence.

## 4. Small dialogs

- [x] 4.1 Move `McpInstallModal` onto `InPageWindow` and delete its backdrop, frame, close, and Escape code. Verified by `scripts/mcp-install-modal.test.mjs` passing, a screenshot of the real dialog in the frame, and `e2e/mcp-install-targets.spec.ts` in 5.4.
- [x] 4.2 Move `RemotePairingModal` onto `InPageWindow` and remove its private drag wiring from `App.tsx`. Verified by a screenshot of the real dialog in the frame, the E2E case that opens a dialog from a window and closes one per Escape, and the Desktop pairing suites in 5.4.
- [x] 4.3 Move `WorktreeSignInDialog` onto `InPageWindow`, passing `busy` while it saves. Verified by a screenshot of the real dialog in the frame and Escape answering "later".
- [x] 4.4 Move `AppUpdateDialog` onto `InPageWindow`. Verified by `scripts/app-updater.test.mjs` passing and the real dialog opening in the frame and closing on Escape.
- [x] 4.5 Confirm a control popup that opens inside a window appears above the frame. Verified by an E2E case choosing an option from a select inside a window.

## 5. Checks and delivery

- [x] 5.1 Update `scripts/web-auxiliary-presenter.test.mjs` and `scripts/web-auxiliary-route-controller.test.mjs` for the shared frame. Verified by both passing.
- [x] 5.2 Add `e2e/in-page-windows.spec.ts` and its harness fixture, running the real frame in a browser under the workspace content security policy. Verified by its 18 tests passing.
- [ ] 5.3 Run `npm run lint`, the smoke unit and contract tests, and `openspec validate --all`. Verified by all exiting zero.
- [ ] 5.4 Open the pull request on `origin` with `tea`. Verified by reading back every commit status on the head SHA as `success` or `skipped`, which includes the ten Electron E2E shards.
