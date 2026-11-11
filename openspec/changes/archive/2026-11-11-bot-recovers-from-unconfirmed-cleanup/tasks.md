## 1. Reproduce

- [x] 1.1 Add `test/bot-cleanup-recovery.test.mjs`, using the bot test runtime's `execFailure` option to fail the agent kill. Before this change, a blocked bot refuses the next chat message with "The execution could not start. Check sign-in…". Verified by the tests failing without the change.

## 2. Recover

- [x] 2.1 In `queue.ts`, track the sessions with unconfirmed cleanup since the last confirmed one. Clear them when the count resets. Add `blocked`, `uncleaned` and `cleaned`. Verified by typecheck and 3.1.
- [x] 2.2 In `service.ts`, add `retryCleanup` and call it in `send` before `queue.unblock`. Refuse a chat message with the cleanup reason while the retry fails. Make `enableBot` and `save` skip `unblock` while blocked. Verified by 3.1.

## 3. Verification

- [x] 3.1 `test/bot-cleanup-recovery.test.mjs` passes. A blocked bot retries each unconfirmed session's kill on the next message and runs it. A failing retry gives the cleanup reason, and the message after that runs. Re-enabling a blocked bot does not throw.
- [x] 3.2 Run each `test/bot-*.test.mjs` file, `openspec validate --all` and `biome lint` on the changed files. Verified by each command's output.
- [ ] 3.3 Pull request checks green. Verified by reading back every commit status on the head SHA.
