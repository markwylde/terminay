## 1. Window record store

- [x] 1.1 Add an `AppWindowStore` in `packages/server-core/src/appWindows/` that writes one versioned JSON file per window under a given directory (temp file + rename, serial and coalescing per window), deletes a file, and loads all files, deleting and reporting any it cannot read or validate. Verified by a unit test covering write, overwrite, delete, a coalesced burst, and a corrupt file.
- [x] 1.2 Define the persisted record as the window's start state only (id, session, project, title, source, state, document, data, CSP, permissions, tool, tool input, tool result, tool cancellation, content revision, created at) and validate it with the same limits `open` applies. Verified by a unit test that a record with transient fields or over-limit content is rejected.

## 2. Service lifecycle

- [x] 2.1 Give `AppWindowService` an optional store; write a window after every mutation that publishes it and delete it whenever a window ends (`close`, `endSession`, `endAll`). Verified by unit tests asserting the store's contents after each operation.
- [x] 2.2 Add `release()` that drops in-memory windows, abandons uploads, and stops the mirror without touching the store. Verified by a unit test that files remain after `release()` and are gone after `endAll()`.
- [x] 2.3 Add `restore(isRunning, projectOf)` that loads the store, keeps records of running sessions with their current project, deletes the rest, cancels an MCP App record with no result or cancellation, bumps content revision, and publishes once. Verified by unit tests for kept, discarded, moved-project, and in-flight-tool records.

## 3. Composition and hosts

- [x] 3.1 In `composition.ts`, call `appWindows.restore(...)` after `reattachHeldSessions` and `restoreWorkspaceOnStartup`, and at shutdown call `release()` when a session holder detaches and `endAll()` otherwise. Verified by a stop/start over the same store directory with a real session holder, in `packages/server-core/test/session-holder-restore.test.mjs` (where the holder harness lives).
- [x] 3.2 Pass an `app-windows/` directory under the data root from `electron/main.ts` (the standalone `apps/terminay-server` host does not compose app windows). Verified by `tsc -p tsconfig.json` reporting nothing in `electron/` and the E2E in 4.1.

## 4. End to end

- [x] 4.1 Make `e2e/app-windows-survive-restart.spec.ts` pass via `npm run test:e2e`: reload keeps the window, and a relaunch keeping the terminal brings back an open and a minimised window by the same id, which the agent can then close.
- [x] 4.2 Add a relaunch case that ends terminals and asserts no window returns and `app-windows/` is empty. Verified by the same E2E run. (The fixture enables the session holder for this spec, as it does for `terminals-survive-restart.spec.ts`.)

## 5. Specs and validation

- [x] 5.1 Run `openspec validate --all` and the unit suites for `packages/server-core`. Verified by both passing.
