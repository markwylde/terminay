## 1. Setting

- [x] 1.1 Add `inspectOtherBots` to `BotProfile`, store validation and client validation. Verify with `bot-store` and client-core `bots` tests for default off, round trip and non-boolean rejection.
- [x] 1.2 Add the Inspect other bots switch and help text to the Profile, saying the bot can read other bots' content and cannot change it. Verify with an E2E test that it is off by default and saves on.

## 2. Inspection tools

- [x] 2.1 Add `runtimeInspect.ts` with the nine tool definitions and the exact response shapes in design.md. Verify with tests that assert exact keys, including nested objects, and a successful read through all nine tools.
- [x] 2.2 Gate every tool on the live setting before target lookup. Verify with tests that call every tool without the setting for known and unknown bots, turn it on and off during an execution, and show it is independent of Terminay MCP access.
- [x] 2.3 Redact each original string before any excerpt, truncation or slice, failing closed. Verify with tests for a token in output, across message excerpts, reason limits, trigger prompts and slice boundaries, and a redaction failure.
- [x] 2.4 Mark every result and tool description as untrusted data. Verify with a test over all nine tools.
- [x] 2.5 Return `not_found` for unknown, deleted and mismatched execution, message and trigger targets, and refuse self-targeting. Verify with tests.
- [x] 2.6 Page with stable order and bound cursors. Verify with tests for create and delete between pages, a changed query, a cursor from another target, an own-bot cursor, default and maximum page sizes, UTF-8 boundaries, prompt and output continuation, and the 8 KiB limit.
- [x] 2.7 Support message search, thread filtering and the running-output conflict. Verify with tests for each.
- [x] 2.8 Register the tools in `runtime.ts` and mention them only in a permitted bot's briefing. Verify with briefing tests for both states.

## 3. Boundaries

- [x] 3.1 Prove no runtime tool can change the setting. Verify with a test that scans tool schemas and attempts the argument, and extend the capability-bound caller test so an MCP caller's bot save is refused.
- [x] 3.2 Prove inspection is read-only. Verify with a test that compares both bots' records, message sequences and events before and after.
- [x] 3.3 Prove own-bot tools stay scoped for a permitted bot. Verify with tests on `sessions_get`, `sessions_output`, `chat_get` and `triggers_get` using another bot's IDs.
- [x] 3.4 Prove stopped and revoked executions cannot inspect. Verify with a test for each.

## 4. Verification

- [x] 4.1 Run the server-core and client-core suites with bounded `node --test`, plus typecheck and lint. Verify that all pass.
- [x] 4.2 Run the bot E2E through `npm run test:e2e` and capture Profile screenshots. Verify that it passes and the screenshots show the setting off and on.
- [x] 4.3 Run `openspec validate bot-inspect-other-bots --strict` and `openspec validate --all`. Verify that this change is valid and that `--all` reports no failure from it.

## Review verification — 2026-11-23

- Reviewed `git diff main...HEAD`, tracked working changes and untracked implementation/artifacts.
- Fixed credential probing through chat search, chat cursor namespace overlap, message snapshot inconsistency and session page sizing before redaction. Added regression tests, in-flight revocation tests and nested allowlist checks.
- Inspection tests: 21 passed. Final full server-core run: 2,604 passed, 24 skipped. The first full run had an unrelated Git watcher cleanup `ENOTEMPTY`; its isolated rerun and the final full run passed.
- Client-core: 294 passed. Browser Bots UI suite: 64 passed, including the branch token-copy coverage. Workspace typecheck: all 27 tasks passed. Changed-file Biome lint: no errors; existing warning/informational diagnostics remain. `git diff --check` passed.
- Docker Bots E2E: 36 passed directly, 3 passed on retry, exit 0. The three flaky tests cover image-build retry, engine-reset recovery and rail resizing. The new Profile test passed both alone and in the complete file.
- Inspected Profile screenshots for both off and on under `.docker-cache/e2e/bot-inspect-review/test-results/bots-Home-Bots-Inspect-oth-759bf-off-by-default-and-saves-on/`; full-run artifacts are under `.docker-cache/e2e/bot-inspect-review-full/`.
- This change validates strictly. `openspec validate --all` reports 125 passed and 8 failed in untouched changes; `openspec validate --all --archived` reports 306 passed and 8 archived changes with incomplete tasks. These unrelated validation failures remain outside this change.
