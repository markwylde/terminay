## 1. Server invariant

- [x] 1.1 Add `packages/server-core/src/liveTerminalPanels.ts`: `runningSessionsWithoutPanel` and `bindLiveTerminalPanels`, which check on workspace change, wait 5 seconds before acting, give a panel in General (`panel.create` when the workspace has the session's record, `terminal.createPanel` when it has none), leave a session whose record names another project, and end a session whose project is gone. Verified by `npm run build -w @terminay/server-core`.
- [x] 1.2 Bind it in `packages/server-core/src/composition.ts`: check once at the end of `start()` after reattach and startup restore, and dispose it before the terminal service stops in both shutdown paths. Add the internal `liveTerminalPanelGraceMs` option for tests. Verified by the server-core suite passing.

## 2. Tests

- [x] 2.1 Add `packages/server-core/test/live-terminal-panels.test.mjs`. It covers: a closed tab whose shell keeps running comes back in General; a terminal spawned without a panel lands in General when General is not first; a terminal placed by its creator gets no second panel; a terminal that exits during the grace gets none; a terminal whose project is gone is ended. Verified by `node --test test/live-terminal-panels.test.mjs` (5 pass).
- [x] 2.2 Run the whole server-core suite. Verified by `node --test test/*.test.mjs` in `packages/server-core` (1556 pass, 0 fail).

## 3. A held terminal the server ends stops running

- [x] 3.1 A session holder reports no exit for a session the server ends, so a closed tab's terminal stayed `running` with no shell and was given its panel back every 5 seconds. In `packages/server-core/src/sessionHolder/factory.ts`, `end` now has the process it handed the terminal service report that exit. Verified by "a session the server ends is no longer running in its terminal service" in `test/session-holder-observation.test.mjs`, which fails without the fix.
- [x] 3.2 Run the whole server-core suite. Verified by `node --test test/*.test.mjs` in `packages/server-core` (1557 pass, 0 fail).

## 4. Validation

- [x] 4.1 Run `openspec validate --all`. Verified by it passing.
- [ ] 4.2 Open a pull request on Gitea and read back every commit status as `success` or `skipped`.
