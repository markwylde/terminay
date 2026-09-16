## 1. Keep a crashed host under supervision

- [x] 1.1 In `packages/server-core/src/extensions/manager.ts`, make `startOne`'s publication catch stop the host only when its status is neither `failed` nor `quarantined`. Verified by the new supervisor test below, which fails on the previous code with "no restart was scheduled" and passes with the change.

## 2. Make the supervisor test decide the gap itself

- [x] 2.1 In `packages/server-core/test/extension-restart-supervisor.test.mjs`, add a test that holds contribution publication until the restarted child has died, then asserts the host is `failed`, a restart is pending, no `stopped` transition was recorded, and the next restart publishes the provider. Verified by `node --test test/extension-restart-supervisor.test.mjs` in `packages/server-core`.
- [x] 2.2 Make the fake clock's "no restart was scheduled" failure report the host states and recorded transitions. Verified by reading the assertion message with the manager fix reverted.

## 3. Checks

- [x] 3.1 Run `openspec validate --all`, `npm run lint`, and `npm run test -w @terminay/server-core`. Verified by all three reporting clean.
- [x] 3.2 Open the pull request on Gitea with `tea`, then read back every commit status on the head SHA and confirm each is `success` or `skipped` before calling it green. Verified by the status listing itself.
