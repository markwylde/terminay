## 1. Startup

- [x] 1.1 In `packages/server-core/src/composition.ts`, run `bots.reconcile()` followed by `bots.triggers.start(...)` as a background task that `start()` does not await; a failed reconciliation is swallowed and triggers still start. Verified by task 2.1.
- [x] 1.2 In `shutdown()`, await that task before teardown, and skip starting triggers once shutdown has begun. Verified by task 2.2.

## 2. Tests

- [x] 2.1 `server-composition.test.mjs`: with a bot service whose reconciliation never answers, `start()` resolves; triggers start only after reconciliation finishes. Verified by the test passing.
- [x] 2.2 `server-composition.test.mjs`: shutdown during reconciliation waits for it and never starts triggers. Verified by the test passing.
- [x] 2.3 `bot-composition.test.mjs` setup awaits `service.reconcile()` after `start()`, so its tests begin after reconciliation. Verified by 21/21 passing three runs in a row.

## 3. Checks

- [x] 3.1 `timeout 1500 node --test --test-force-exit --test-timeout=120000 test/*.test.mjs` in `packages/server-core`. Verified by no failures.
- [x] 3.2 `npx biome check` on the changed files and `openspec validate startup-does-not-wait-for-bots --strict`. Verified by no errors.
