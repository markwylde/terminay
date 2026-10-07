## 1. Reproduce

- [x] 1.1 Add the end-to-end test "a window that arrives while another project is in front stays with its own project" to `e2e/app-windows.spec.ts`. Verified by `npm run test:e2e -- e2e/app-windows.spec.ts -g "stays with its own project"` failing on `main` with the window visible over the other project.

## 2. Fix

- [x] 2.1 Make `isPaneVisible` in `src/workspace/appWindows/appWindowPanes.ts` also require the pane element's computed `visibility` to be `visible`, and update its comment. Verified by the test from 1.1 passing.
- [x] 2.2 Confirm the host re-measures after a project switch and after selecting Home, adjusting the `APP_WINDOW_LAYOUT_EVENT` dispatch in `src/App.tsx` only if it does not. Verified by 2.3.
- [x] 2.3 Extend the test from 1.1 to cover switching away from a project with an open window (hidden, and a click where it was reaches the project in front) and two projects each holding a window. Verified by the test passing.

## 3. Verify

- [x] 3.1 Run the whole of `e2e/app-windows.spec.ts` and `e2e/app-view-mirror.spec.ts` through `npm run test:e2e`. Verified by every test passing, including "an agent shows its own HTML in a window that minimises to an edge tab", which covers terminal and project switches.
- [x] 3.2 Run the renderer unit tests and typecheck. Verified by both exiting zero.
- [x] 3.3 Run `openspec validate --all`. Verified by it reporting no errors.
