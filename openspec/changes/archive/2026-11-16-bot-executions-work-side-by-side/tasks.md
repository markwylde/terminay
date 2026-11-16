## 1. Host runtime

- [x] 1.1 In `packages/server-core/src/botService/runtime.ts`, remove the `work_acquire`/`work_release` tool definitions and their `call` cases, the `work` owner map, `release()`, the `work.acquired`/`work.released` events, `ownsWork` in `summary()` and in the replacement receipt, and the ownership transfer in replacement. Rewrite the `sessions_replace` description so it no longer promises to transfer ownership. Keep `reservePromotion`/`promote` around replacement for admission. Verify: `rg -n "work_acquire|work_release|ownsWork|this\.work\b|work\.acquired|work\.released|transfer work" packages/server-core/src docker/terminay-bot` prints nothing.
- [x] 1.2 Replace `assertWork` with the existing liveness check (`assert`), and make `runtimeBridge.ts` answer `runtime/check-work` with it. Verify: task 3.2.
- [x] 1.3 Remove the `runtime.release(...)` calls from `service.ts` (stop, finish and failure paths). Verify: the `packages/server-core` typecheck passes.
- [x] 1.4 Rewrite the briefing. Define active as running or needs-you, and use that filter for both `otherExecutions` and `totalOtherExecutions`. Add a `queuedExecutions` count, and drop the `coordinationOnly` field. Replace the "call work_acquire" line with the decision line: state the active count; stop, steer with `sessions_post`, replace, or leave each related execution. Add the shared-desktop warning, including re-checking with `sessions_list`/`events_next` before taking the desktop, and remove "Trigger tools do not need the shell work lease." Verify: a runtime test with running, needs-you, revoked and queued peers asserts the counts, that only active summaries are listed, and the warning text, and that `work_acquire` is not mentioned.

## 2. Admission

- [x] 2.1 In `BotTurnQueue`, when an execution ends, promote the oldest reserved-slot (`coordinationOnly`) execution into a free ordinary slot before dispatching waiting work. Verify: queue tests cover (a) four work executions plus a reserve, one work execution ends, the reserve is promoted, and a second chat is admitted to the reserve at once; (b) replacement promotion still reserves the freed slot for the correction; (c) a trigger is never admitted to the reserve.

## 3. Bot image gates

- [x] 3.1 In `terminay-tool-shell` and `terminay-shell-env`, unset `TERMINAY_RUNTIME_SOCKET` (and `TERMINAY_MCP_SOCKET`) along with the tokens once the gate has passed, and update the comments to describe a liveness gate. Keep the exact adapter bootstrap cases unchanged. Verify: the regression test in 3.3, and the existing `bot-terminay-relay` bootstrap/variant tests pass.
- [x] 3.2 In `terminay-desktop-mcp.mjs`, change both refusal texts ("Acquire shared work…" in `checkWork` and "Execution does not own shared work." in the browser wrapper) to "This execution is no longer active." Verify: a node test drives `terminay-desktop-mcp.mjs` in desktop mode and in `--cap-output` wrapper mode with a fake adapter. A live check lets `tools/call` through, a failed check returns the new text, and `rg "shared work" docker/terminay-bot` prints nothing.
- [x] 3.3 Add a regression test that runs the real gate scripts with the real adapter against a fake runtime. A command refused while the capability is not live, followed by commands once it is live, must all run. A gated command that starts a nested `bash` (with `BASH_ENV` still exported by the agent) must not fail with "runtime request failed or capability revoked". Re-running a command with an environment captured from inside an earlier gated command must not fail the same way. Verify: the test fails against the current scripts and passes after 3.1.

- [x] 3.4 Give `terminay_desktop` and `terminay_browser` the runtime pair in `runtimeBridge.ts`. Add exact-command bootstrap cases for both to `terminay-tool-shell`, and have `terminay-desktop-mcp.mjs` move the pair out of its environment and pass it only to its check. Verify: the real-container test launches the desktop MCP through the prefix, with a live tool call not refused and a revoked one refused, and the Codex relay test asserts the desktop server's environment names.

## 4. Tests

- [x] 4.1 Update `bot-runtime-bridge`, `bot-runtime-real`, `bot-terminay-relay`, `bot-triggers` and `bot-runtime` tests, and the `bot-anthropic-model` fixture, to drop `work_acquire`/`ownsWork`. Verify: they pass under `node --test --test-force-exit --test-timeout=120000`.
- [x] 4.2 Add bridge tests in which two live executions of one bot both pass `runtime/check-work` at the same time, through both `terminay-tool-shell` and `terminay-shell-env`. Check refusal for a stopped execution, a normally ended execution, a stale epoch, and a replaced execution while its replacement cleanup is still pending. Verify: the tests pass, and fail if a single-owner check is reintroduced.
- [x] 4.3 Run the full `packages/server-core` and `extensions/builtin-agents` suites, plus repository lint and typecheck. Verify: all pass. Real-container tests that skip locally for want of the image environment are recorded as skipped, and task 6.2 confirms the required real-container CI job runs them without skipping.

## 5. Specs and archive

- [x] 5.1 Run `openspec validate --all`. Verify: zero failures.
- [x] 5.2 Archive the change so its deltas fold into `openspec/specs/`, then run `openspec validate --all` and `openspec validate --all --archived`. Verify: both report zero failures, and `rg -n "work_acquire|shared-work ownership|exclusive bot-scoped" openspec/specs` prints nothing.

## 6. Ship

- [ ] 6.1 Commit, push the branch to `origin` (Gitea), and open the pull request with `tea`. Verify: the PR exists on Gitea and links this change.
- [ ] 6.2 Read back every commit status on the PR head SHA. Verify: each is `success` or `skipped`, including the real bot-container job.
