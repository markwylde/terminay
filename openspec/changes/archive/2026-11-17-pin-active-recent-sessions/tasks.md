## 1. Model

- [x] 1.1 Add `isActiveSession` (queued, running, needs-you) and `recentSessions(sessions, limit)` to `src/workspace/bots/botsModel.ts`. Verified by the unit tests in 1.2.
- [x] 1.2 Add `botsModel.test.ts` cases: older active pinned above newer inactive; queued, running and needs-you all pinned; active group newest first; inactive group newest first; suspended not pinned; cap applied after pinning keeps an old active session; more than six active keeps the six newest active; input not mutated. Verified by `node --test --test-force-exit --test-timeout=120000 --experimental-strip-types src/workspace/bots/botsModel.test.ts` passing.

## 2. Projection

- [x] 2.1 Extract `retainRecentSessions(sessions, limit)` into `botsModel.ts` and use it in `useServerBots.ts`: the 20 newest plus every older active session, newest first. Verified by unit tests (active session older than 25 ended sessions is kept; result stays newest first) in the command from 1.2.

## 3. Rail

- [x] 3.1 Render `recentSessions(sessions, 6)` in `BotContextRail.tsx`, use `isActiveSession` for the Stop button, and mark active rows with `data-terminay-bot-sess-active`. Verified by `npx tsc --noEmit` and the E2E in 4.1.
- [x] 3.2 Use `isActiveSession` for `BotChat`'s active list. Verified by typecheck.
- [x] 3.3 Pulse active dots with `bots-pulse` in `botPanels.css`, disabled under `prefers-reduced-motion`. Verified by the animation assertions in 4.1.

## 4. End to end

- [x] 4.1 Extend `e2e/bots.spec.ts` ("a new message completes while an older execution is held"): the held running session is the first rail row above newer completed ones, marked active, with a dot whose animation is `bots-pulse` while completed dots have none; under emulated reduced motion the active dot does not animate; after Stop it moves into the inactive group newest first. Verified by `npm run test:e2e -- e2e/bots.spec.ts -g "older execution is held"` passing.
- [x] 4.2 Capture screenshots of the rail with a pinned active session and after it ends. Verified by the PNGs existing under the scratchpad `screenshots/` folder.

## 5. Checks

- [x] 5.1 Run `npm run lint`, `npx tsc --noEmit`, the unit command from 1.2, and `openspec validate pin-active-recent-sessions`. Verified by each exiting 0.
