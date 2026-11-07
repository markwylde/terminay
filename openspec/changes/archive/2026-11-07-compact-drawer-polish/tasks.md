## 1. Tree

- [x] 1.1 Lay folder headers and panel rows on one grid: chevron, glyph, name / indent, status, title. Every folder gets a glyph, and the current-row highlight spans the header width. Verified by a 390px screenshot and a unit test asserting a glyph on every folder header.
- [x] 1.2 Make the folder header line the collapse toggle, expose `aria-expanded`, and add Show folder to the ⋯ menu (also on another connection). Verified by e2e: pressing a folder name collapses it with the drawer open, and Show folder dismisses and shows the folder.
- [x] 1.3 For an empty folder, hide the count and the header + control, and draw the New terminal entry as a quiet aligned row that carries the folder's new-terminal name. Verified by a unit test and the existing linked-folders empty-folder e2e test.
- [x] 1.4 Give each panel row a trailing ⋯ control that opens its menu, and keep the dial in its own column before it only when a workflow is attached. Verified by a unit test (a ⋯ on every row, no empty dial slot) and an e2e test that opens the row menu from ⋯.

## 2. Drawer shell

- [x] 2.1 Add a close control to the panel header, and route a press on the strip through the same layer order as Escape. Verified by e2e: the strip press closes the filter first, then a menu first, and the close control dismisses.
- [x] 2.2 Make the drawer width `min(420px, 100% - 52px)` with a darker scrim. Use max(8px, safe-area) bottom padding on the rail, create bar, and sheets. Verified by a 390px screenshot.
- [x] 2.3 Give every control a target at least 44px tall, a pressed state, and stronger muted contrast. Verified by a unit test over the CSS for target sizes.

## 3. Rail

- [x] 3.1 Add visible labels under Home and project tiles. Build a project's accessible name from its title plus summary text. Draw Home unfilled until selected and keep badges clear of the ring. Verified by unit tests on the accessible name and markup, and by a screenshot.
- [x] 3.2 Use `touch-action: manipulation` on rail tiles outside edit mode and `none` only while editable. Verified by a unit test over the CSS.

## 4. Create bar

- [x] 4.1 Show the target folder under the launcher name on the split control, and point its disclosure chevron up, rotating while the dropup is open. Verified by a unit test on the label and the existing create-bar e2e tests.

## 5. Verification

- [x] 5.1 Run `npx tsc --noEmit -p .`, the unit tests, and the touched e2e specs via `npm run test:e2e`. Verified by their output.
- [x] 5.2 Recapture the 390px visual screenshots, review them, and attach them to the PR. Verified by the screenshots in the PR body.
