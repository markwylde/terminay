## 1. Reproduce

- [x] 1.1 Add a `killFailures` option to `test/fixtures/bot-test-runtime.mjs` that fails `terminay-run --kill`. Add `test/bot-cleanup-recovery.test.mjs`. One failed kill must leave the next chat message refused with "The execution could not start. Check sign-in…". Verified by the new tests failing on `main`.

## 2. Recover

- [x] 2.1 In `queue.ts`, record the session ids whose run rejected. Pass the error to the `failure` hook. Add `blocked`, `uncleaned` and `cleaned`. Verified by typecheck and 3.1.
- [x] 2.2 In `service.ts`, add `retryCleanup` and call it in `send` before `queue.unblock`. Write the redacted engine error to runner output. Refuse a chat message with the cleanup reason while the retry fails. Make `enableBot` and `save` skip `unblock` while blocked. Verified by 3.1.

## 3. Verification

- [x] 3.1 `node --test --test-force-exit --test-timeout=120000 test/bot-cleanup-recovery.test.mjs` passes. One failed kill is retried on the next message and the message runs. Two failed kills give the cleanup reason, then the message after that runs. The engine error is in runner output. Re-enabling a blocked bot does not throw.
- [x] 3.2 Run each server-core test file, `openspec validate --all`, `npm run lint` and `npm run typecheck`. Verified by each command's output.
- [ ] 3.3 Pull request checks green. Verified by reading back every commit status on the head SHA.
