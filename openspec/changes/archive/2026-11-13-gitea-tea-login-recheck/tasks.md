## 1. Tea token store

- [x] 1.1 In `extensions/gitea/src/teaConfig.ts`, make a load install the watch before reading, and memoise the result only when the read succeeded and a watch is live; a failed read or failed watch install leaves no memo. Verified by tasks 2.1 and 2.3.
- [x] 1.2 On a change event, clear the memo, close and forget the watcher, and clear per-origin rejections, so an in-flight read is not retained and the next lookup re-watches and re-reads. Verified by tasks 2.2 and 2.4.
- [x] 1.3 In `extensions/gitea/src/index.ts`, forward watcher `error` to the store's change handler instead of only closing it. Verified by task 2.3 (the store's handling) and by code review of the adapter.

## 2. Tests (`extensions/gitea/test/tea-store.test.mjs`)

- [x] 2.1 First read throws ENOENT and no watch can be installed; a later read returns a config; `origins()` and `token()` return the new login. Verified by the test passing.
- [x] 2.2 Lifecycle: read → delete (event) → failed read → re-create → successful read with a fresh watch → edit (event) → new token; and a rename-replace (event on the old watch) → new token. Verified by the test passing and asserting the watcher count and close calls.
- [x] 2.3 Watch install throws, or the watcher reports an error: the store does not keep a memo and re-reads on the next lookup. Verified by the test passing.
- [x] 2.4 A change event that arrives while a read is in flight: the stale result is not memoised and the next lookup reads again. Verified by the test passing.
- [x] 2.5 Rejection: token A is rejected and stays unused across lookups while the file is unchanged; after a change event writes token B for the same origin, B is returned. Verified by the test passing.
- [x] 2.6 Drive `createGiteaForgeSource(...).accounts()` with the real token store: no account before the file exists, the tea account (credential source `cli-config`) after it is created. Verified by the test passing.

## 3. Checks

- [x] 3.1 `timeout 600 npx turbo run build --filter=terminay-gitea^...` to build its dependencies, then `timeout 600 npm test -w terminay-gitea` (compiles and runs `node --test --test-force-exit --test-timeout=120000`). Verified by exit 0, including the existing "read once" test.
- [x] 3.2 `timeout 300 npx biome lint extensions/gitea`, `timeout 300 npx biome check extensions/gitea/test/tea-store.test.mjs`, and `timeout 600 npm run typecheck -w terminay-gitea`. Verified by no errors (formatting that already differed in untouched lines of `index.ts` and `teaConfig.ts` is left alone).
- [x] 3.3 `openspec validate gitea-tea-login-recheck --strict` and `openspec validate --all`. Verified by this change passing and no new failures elsewhere.
