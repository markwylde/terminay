## 1. Model

- [x] 1.1 Add `botUnreadCounts(snapshot, bots)` and `botUnreadLabel(count)` to `src/workspace/publishedNotifications.ts`. Verify: `node --test --test-force-exit --test-timeout=120000 --experimental-strip-types scripts/published-notifications.test.mjs` passes cases for several posts from one bot, totals across bots, terminal records ignored, an unknown bot skipped, no snapshot or no bots, the server id carried, and the singular and plural labels.

## 2. Presentation

- [x] 2.1 Show the total on the project bar's Home control in `src/App.tsx` with a corner badge styled in `src/App.css`, reading `99+` above 99, and state the exact count in the control's accessible name. Leave the compact chrome row's Home control unchanged. Verify: the e2e scenario in 3.1, and a unit case showing `formatActivityCount(120)` is `99+` while `botUnreadLabel(120)` says 120.
- [x] 2.2 Pass the total as the `bots` entry of `sectionBadges`. Verify: the e2e scenario in 3.1; the badge comes from `sectionBadges` alone, which `HomeView` draws whether or not the section's tab is open.
- [x] 2.3 Show each bot's count on its row in `BotsSidebarList.tsx`, after the running time, matched on server id and bot id, and state it in the row's accessible name. Verify: the e2e scenario in 3.1, and a unit case showing the counts carry their server id.

## 3. End to end and checks

- [x] 3.1 Extend the bot notification scenario in `e2e/bots.spec.ts`: two posts while the bot's tab is in Configure show `2` on the Home control, the Bots item, and the bot's row, while the header Notifications count stays 1, with accessible names stating two unread messages; dismissing the notification clears all three while Chat's divider remains; a later post that is then read by opening Chat clears all three again. Capture screenshots of the counts. Verify: `npm run test:e2e -- e2e/bots.spec.ts` passes in Docker. Verified in CI's Docker E2E shard 3/18 on PR #532 (run 24565, job 75590); the local Podman VM had no memory to build the image.
- [x] 3.2 Run `openspec validate bot-unread-counts-on-home`, `openspec validate --all`, Biome on the changed files, and the app typecheck. Verify: each command's output; `--all` reports no failure in this change, and its failures in other in-flight changes are listed separately.
