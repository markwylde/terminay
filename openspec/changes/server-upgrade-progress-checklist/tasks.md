## 1. Model

- [x] 1.1 Add per-profile `progress` (mode, from, to, initiatedHere, restarting, four steps with `waiting | running | done | failed` and optional detail, ended) to `ServerUpgradeBoard`'s snapshot, derived as in design.md's table. Verified by new cases in `src/workspace/serverUpgradeModel.test.ts` for: accept → install → restart → success; rollback; `none` on the old version; `none` on the target version; ready-but-silent at the deadline; incompatible on return; lost at the deadline and on `unreachable`; a return after `lost` leaving the ended progress unchanged; an upgrader that finishes without restarting; an observer following from in-progress status; and a status that arrives before `markStarted`.
- [x] 1.2 `markStarted(profileId, { mode, to })` and `closeProgress(profileId)` (only once ended). Verified by unit tests that the final state persists after the outcome until close, that close before the end does nothing, and that close removes the progress record.
- [x] 1.3 Remember `initiated`, `mode` and `to` beside `following`, and restore the full progress on `recall`. Verified by a unit test that a new board on the same memory, synced with a dropped then returning connection, reports the same target and mode with **Restarting** running, and that an entry without the new fields restores as an observer.
- [x] 1.4 `ServerUpgradeRow.step` names the running step; `describeConnection` reports "Restarting for upgrade…" when given `upgradeRestarting`. Verified by unit tests for both.
- [x] 1.5 Keep notifications as specified: success, rollback, moved-to-target and lost each told once; the three new failure endings tell nothing new. Verified by unit tests on `snapshot.notices`.

## 2. Window shell and workspace

- [x] 2.1 New `ServerUpgradeBoardHost` inside `ConnectionsProvider` in `src/web/main.tsx` owns, syncs and disposes the board and provides it by context; `useServerUpgrades` consumes it and owns one only without a provider. Verified by `tsc --noEmit`, by `useServerUpgrades` disposing only a board it created itself, and by e2e 4.1 seeing the card survive the workspace remount.
- [x] 2.2 New `src/workspace/ServerUpgradeProgress.tsx`: titled card, `role="status"`, ordered step list with state in text, no dismiss action while running, **Close** once ended; styles beside the existing server-upgrade styles. Verified by e2e assertions on the role, step texts and states (4.1).
- [x] 2.3 The board host draws the card for the primary connection's followed upgrade in one place: centred on a fixed full-window backdrop that takes every pointer event, from following (any device) until the end, and on the initiating device until closed; `main.tsx` draws no reconnecting text then. Verified by e2e 4.1 asserting the overlay holds the card and no "Terminal stream stalled" or "Connection lost" text.
- [x] 2.4 Pass `upgradeRestarting` to `ConnectionsControl` and print `step` in `ServerUpgradeMenuRows`. Verified by e2e 4.1 reading the connection menu.
- [x] 2.5 Pass `{ mode, to }` from the confirmation into `markStarted`. Verified by unit test 1.2 and e2e 4.1 seeing the target on the card.

## 3. Checks

- [x] 3.1 `npx tsc --noEmit -p tsconfig.json`, `npm run lint`, and the workspace unit tests (`node --test --test-force-exit --test-timeout=120000` as the scripts run them) pass. Verified by their output.
- [x] 3.2 `openspec validate --all` reports this change valid, with the known archive-order note for the modified requirement; its failures are in other in-flight changes and predate this one. Verified by its output.

## 4. End to end

- [x] 4.1 Extend `e2e/server-upgrade.spec.ts`: confirm an upgrade against the fake upgrader and assert the card (status role, name, versions) and its steps through install and success, the menu row naming the step, then **Close**. Capture screenshots of each state. Verified by `timeout 3000 npm run test:e2e -- e2e/server-upgrade.spec.ts` passing in Docker.
- [x] 4.2 In the restart-and-rollback test, assert the reconnecting overlay holds the card with **Restarting** running and no stall or connection-lost text, then the card's failed **Running** step with the reason, and **Close**. The "Restarting for upgrade…" status, and restoring the card after a reload are covered by the unit tests in 1.2–1.4 and `scripts/connections-control.test.mjs`, where they are deterministic. Verified by the same run.

## 5. One modal card

- [x] 5.1 Remove **Hide** and the board's `hidden` state; the card has no dismiss action until the upgrade ends. Verified by the model and UI unit tests.
- [x] 5.2 Draw the card in one place only: a fixed, full-window backdrop with the card centred, replacing both the bottom-right card and the card inside the reconnecting overlay. Verified by e2e asserting the card's position is the same while installing, restarting, and after the outcome, and that the backdrop covers the window.

## 6. No ticklist waits for ever

- [x] 6.1 Once following, an outcome the board has already seen, or one stamped before the upgrade's start, no longer leaves the ticklist waiting: the version the server runs decides success or "still on". A restarted server that reports the upgrade in progress again does not move the start. Verified by the model tests "a restarted server that says it is still upgrading does not move the start", "an outcome already seen still ends a followed upgrade by the version it runs", and "a server that moves version without a restart or an outcome is upgraded".
- [x] 6.2 Every wait (an upgrader that finished without a restart, a returned server still in progress) is held to the reconnect deadline and ends silent. Verified by "a followed upgrade can never wait for ever once the server is back".
