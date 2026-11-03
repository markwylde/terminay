## 1. Break the observation feedback loop

- [x] 1.1 Guard unchanged environment state and preserve idle deadlines; verify repeated reconcile emits nothing and does not postpone idle stop in bot-environment tests.
- [x] 1.2 Filter Docker/Podman events to known main containers and coalesce per-bot reconciliation; verify helper, workload, foreign and unknown events do no work, main-container bursts remain bounded, and disposal/removal cancels pending work.
- [x] 1.3 Add an authorized typed environment-state query and client API; verify permission, missing-bot and response contracts in server/client protocol tests.
- [x] 1.4 Replace useServerBots overview reads with cheap state queries; verify initial list load and change-driven refresh perform no stats, logs or home-size helper runs.
- [x] 1.5 Add a two-bot integration regression that feeds overview helper lifecycle events through composition and client refresh; verify the system settles with no additional changes or measurements.

## 2. Retain actionable failures

- [x] 2.1 Map BotError, EngineCommandError and BotImageBuildError through shared bounded sanitized error formatting; verify structured reason codes and no secret leakage in dispatcher tests.
- [x] 2.2 Unify chat/trigger engine preflight and failure reasons while allowing missing-image preparation; verify engine stopped, identity changed, unavailable agent, missing image and failed build execution paths.
- [x] 2.3 Persist redacted startup causes in Runner output when provider output is absent; verify diagnostic persistence and credential/runtime-token redaction in session tests.

## 3. Recover from unavailable and reset engines

- [x] 3.1 Add a common recovery banner to individual bot views using existing engine actions; verify reason visibility, Check again, confirmed Use this engine, Build image and create/recreate actions in UI coverage.
- [x] 3.2 Ensure prepareSession rebuilds a missing image and creates missing owned container/home/network resources after explicit adoption; verify progress states, first-run success, ownership refusal and no mutation before identity confirmation.
- [x] 3.3 Separate confirmed local deletion from engine removal using durable original-engine-scoped deletion intents and a typed warning result; verify local profile/trigger/session/message removal and capability revocation during outages.
- [x] 3.4 Process pending resource removal on verified availability and restart; verify interrupted deletion recovery, idempotency, preserved-home choice, foreign-resource refusal and no work against a different engine identity.

## 4. Diagnose and verify MCP startup

- [x] 4.1 Preserve primary relay startup errors during failed teardown and capture bounded redacted relay/adapter diagnostics; verify readiness timeout, early exit, revoked capability and missing socket/token propagation cases in runtime-bridge tests.
- [x] 4.2 Run a fresh real-adapter bot after loop fixes and verify terminay_bot tool use; if failure persists, capture its concrete startup cause and fix the evidenced path, with a regression test and recorded outcome.

## 5. Validate the complete change

- [x] 5.1 Run relevant server/client bot suites, UI checks, type checking and lint; verify all changed protocol surfaces and lifecycle tests pass.
- [x] 5.2 Run relevant Electron E2E coverage through npm run test:e2e; verify two-bot navigation settles, recovery controls work and deletion during outage completes, recording any environmental blocker.
- [x] 5.3 Run openspec validate --all and openspec validate --all --archived; verify this change passes and distinguish unrelated pre-existing failures.

## 6. MCP socket ownership follow-up

- [x] 6.1 Assign a root-created relay socket to the image's bot account while retaining mode 0600; verify both supervisor and direct-root launch in real containers with distinct process users.
- [x] 6.2 Verify bot-user preflight rejects an inaccessible socket and preserves permission-denied stderr; verify a chat startup failure cannot be marked Completed.
- [ ] 6.3 Build the production bot image with its pinned Claude adapter in a required Gitea job, run real ownership/tool-posting tests without the optional-test skip, and verify the job passes.
- [ ] 6.4 Run relevant unit and Docker-isolated Electron tests, update verification evidence, and read all final PR statuses before handoff.
