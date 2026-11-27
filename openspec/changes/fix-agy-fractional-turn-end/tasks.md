## 1. Adapter fix

- [x] 1.1 In `extensions/builtin-agents/src/source.ts`, publish `lastTurnEndedAt` as `Math.floor` of the library value, and omit it when the value is not finite or floors outside `[0, Number.MAX_SAFE_INTEGER]`. Verified by 1.2–1.4.
- [x] 1.2 In `extensions/builtin-agents/test/source.test.mjs`, test a catch-up reset holding a Claude Code session and an Antigravity session whose turn ends at `1795772970190.7083` before `ready`: the one reset carries `1795772970190` and passes `validateAgentSessionReset`; and test that with both harnesses live every later reset and upsert stays valid. Verified by the bounded run in 1.5.
- [x] 1.3 Test a live upsert after `ready` with a fractional end time: it is published floored and passes `validateAgentSessionSnapshot`. Verified by the bounded run in 1.5.
- [x] 1.4 Test unusable end times (`NaN`, `Infinity`, `-Infinity`, `-1`, `Number.MAX_SAFE_INTEGER + 2`) are omitted, an absent end time stays absent, and an integer end time is unchanged. Verified by the bounded run in 1.5.
- [x] 1.5 Build and run: `npx turbo run build --filter=terminay-builtin-agents...` then `timeout 600 npm test` in `extensions/builtin-agents` (its script uses `node --test --test-force-exit --test-timeout=120000`). All pass.

## 2. Host regression tests

- [x] 2.1 In `packages/server-core/test/session-source-bridge.test.mjs`, replace the exploratory test that expects a fractional publication to be accepted with one that publishes agy's observed session (`antigravity`, direct child of the terminal's shell, `idle`, completed turn, `lastTurnEndedAt: 1795772970190`, ended before the entry existed) and asserts the root is bound to that terminal, its state is exactly `idle`, and the terminal's activity snapshot carries provider state `idle` and status `idle`. Verified by 2.3.
- [x] 2.2 Add a test that publishing the same session with the unfloored `1795772970190.7083` is refused with `ok: false` and leaves the store unchanged, so host validation stays strict. Verified by 2.3.
- [x] 2.3 Build and run: `npx turbo run build --filter=@terminay/server-core...` then `timeout 600 node --test --test-force-exit --test-timeout=120000 test/session-source-bridge.test.mjs` in `packages/server-core`. All pass.

## 3. Validation

- [x] 3.1 Run `timeout 900 npm test` in `packages/server-core` (after building `@terminay/protocol-conformance`) and `openspec validate --all`; the tests pass and this change validates. `validate --all` still reports 13 failures in other changes, which were already failing on `main` and are unrelated.
