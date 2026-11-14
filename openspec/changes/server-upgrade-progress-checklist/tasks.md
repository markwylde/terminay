## 1. Model

- [x] 1.1 Add per-profile `progress` (mode, from, to, initiatedHere, hidden, four steps with `waiting | running | done | failed` and optional detail, ended) to `ServerUpgradeBoard`'s snapshot, derived as in design.md's table. Verified by new cases in `src/workspace/serverUpgradeModel.test.ts` for: accept → install → restart → success; rollback; `none` on the old version; `none` on the target version; ready-but-silent at the deadline; incompatible on return; lost at the deadline and on `unreachable`; a return after `lost` leaving the ended progress unchanged; an upgrader that finishes without restarting; an observer following from in-progress status; and a status that arrives before `markStarted`.
- [x] 1.2 `markStarted(profileId, { mode, to })`, `hideProgress(profileId)` (only while connected and not ended) and `closeProgress(profileId)` (only once ended). Verified by unit tests that the final state persists after the outcome until close, that hide keeps following and the outcome, and that close removes the progress record.
- [x] 1.3 Remember `initiated`, `mode` and `to` beside `following`, and restore the full progress on `recall`. Verified by a unit test that a new board on the same memory, synced with a dropped then returning connection, reports the same target and mode with **Restarting** running, and that an entry without the new fields restores as an observer.
- [x] 1.4 `ServerUpgradeRow.step` names the running step; `describeConnection` reports "Restarting for upgrade…" when given `upgradeRestarting`. Verified by unit tests for both.
- [x] 1.5 Keep notifications as specified: success, rollback, moved-to-target and lost each told once; the three new failure endings tell nothing new. Verified by unit tests on `snapshot.notices`.

## 2. Window shell and workspace

- [x] 2.1 New `ServerUpgradeBoardHost` inside `ConnectionsProvider` in `src/web/main.tsx` owns, syncs and disposes the board and provides it by context; `useServerUpgrades` consumes it and owns one only without a provider. Verified by `tsc --noEmit`, by `useServerUpgrades` disposing only a board it created itself, and by e2e 4.1 seeing the card survive the workspace remount.
- [x] 2.2 New `src/workspace/ServerUpgradeProgress.tsx`: titled card, `role="status"`, ordered step list with state in text, **Hide** while running and connected, **Close** once ended; styles beside the existing server-upgrade styles. Verified by e2e assertions on the role, step texts and states (4.1).
- [x] 2.3 The board host draws the card in the reconnecting overlay in place of its text for the primary connection's followed upgrade, and as a small card otherwise for the initiating device; `main.tsx` stops drawing its own text then. Verified by e2e 4.1 asserting the overlay holds the card and no "Terminal stream stalled" or "Connection lost" text.
- [x] 2.4 Pass `upgradeRestarting` to `ConnectionsControl` and print `step` in `ServerUpgradeMenuRows`. Verified by e2e 4.1 reading the connection menu.
- [x] 2.5 Pass `{ mode, to }` from the confirmation into `markStarted`. Verified by unit test 1.2 and e2e 4.1 seeing the target on the card.

## 3. Checks

- [x] 3.1 `npx tsc --noEmit -p tsconfig.json`, `npm run lint`, and the workspace unit tests (`node --test --test-force-exit --test-timeout=120000` as the scripts run them) pass. Verified by their output.
- [x] 3.2 `openspec validate --all` reports this change valid, with the known archive-order note for the modified requirement; its failures are in other in-flight changes and predate this one. Verified by its output.

## 4. End to end

- [x] 4.1 Extend `e2e/server-upgrade.spec.ts`: confirm an upgrade against the fake upgrader and assert the card (status role, name, versions) and its steps through install and success, the menu row naming the step, then **Close**. Capture screenshots of each state. Verified by `timeout 3000 npm run test:e2e -- e2e/server-upgrade.spec.ts` passing in Docker.
- [x] 4.2 In the restart-and-rollback test, assert the reconnecting overlay holds the card with **Restarting** running and no stall or connection-lost text, then the card's failed **Running** step with the reason, and **Close**. **Hide**, the "Restarting for upgrade…" status, and restoring the card after a reload are covered by the unit tests in 1.2–1.4 and `scripts/connections-control.test.mjs`, where they are deterministic. Verified by the same run.
