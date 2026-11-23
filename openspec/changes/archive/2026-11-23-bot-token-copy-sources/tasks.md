## 1. Server

- [x] 1.1 Return per-token `copySources` from `bots.credentials.options`, and refuse a copy from a bot without the token. Verified by `bot-credentials-protocol.test.mjs`.

## 2. Sign-in UI

- [x] 2.1 List only `copySources`, hide the control when empty, and refresh open sections after a token change. Verified by `scripts/bots-ui.test.mjs`.

## 3. Verification

- [x] 3.1 Run the credential and token tests, the bots UI suite, `openspec validate bot-token-copy-sources --strict`, `biome lint` on the changed files, and `turbo run typecheck`. Verified by each command's output.
- [x] 3.2 Pull request checks green. Verified by reading back all 30 commit statuses on `4928068a` as `success`.
