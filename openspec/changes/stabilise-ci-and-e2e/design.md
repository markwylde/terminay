## Context

CI retries each E2E test twice, so most flakes appear green. Repeating the two worst tests with retries off reproduced both, and the app's own error output identified the folder-launch cause. Prior decisions that constrain this work are ADR-0070 (view operations are applied by the agent's client), ADR-0103 (MCP never moves the view implicitly), ADR-0036 and ADR-0123 (CI budget), and ADR-0122 (download caches).

## Goals / Non-Goals

**Goals:** fix the product races behind the worst flakes, remove the two infrastructure failures, and prove the result with retries off.

**Non-Goals:** raising Playwright retries or assertion timeouts to mask failures, skipping or quarantining tests, or changing the protocol.

## Decisions

### A located project is waited for inside the existing tab wait

`locate` currently refuses at once if the project has not reached the window, although `showProject` already waits for the same condition. `locate` will treat a project not yet held as "not found yet" and use its one existing `waitFor`. On timeout it reports the not-held refusal. Each wait stays capped at 5 seconds, and every wait in one view operation also shares a 9-second deadline, because `focus`, `place` and `arrange` run several waits in sequence and the relay expires a request at 10 seconds.

Boundary: this is renderer presentation only. Server scope checks are unchanged, and the wait cannot reach a project the server did not admit. A request for a project genuinely in another window now takes up to 5 seconds to refuse, which is acceptable for an error path.

### Project saves are serialised per project and only write a changed root

Today a save writes the root, refreshes, then writes the full presentation record including that root. `project.update` treats any differing root as a move, so a delayed write from save 1 can undo save 2. A per-project promise chain orders the write phase of saves from this client. Each presentation-write attempt rebuilds its request from the latest snapshot, so it carries the root the server last committed, including one set by another client after this save's explicit root move. The explicit root command is the only phase that moves the root. The local root is left alone when the person left the field unchanged; after an explicit move it uses the final refreshed root. The field is still sent, because removing `root` from `project.update` would change the protocol for a client-side bug.

Stale-revision retries move into one helper, bounded at 4 attempts, because a busy workspace can advance the revision again during the single retry. Exhaustion, any other conflict, and a failed refresh surface as a failed save, and the chain continues with the next save.

### A finished edit never takes focus from a newer editor

After a save, the hook restores terminal focus two frames later. If the editor has been reopened by then, focus moves to xterm and typed text reaches the shell, which is why this is a terminal-input boundary and not only a test problem. Each edit takes a generation when it opens, and focus is restored only if that generation is still the latest. Delaying the restore further was rejected because it only narrows the race.

The in-page editor also keeps its terminal-input hold until its commit wait finishes and the surface closes. That completion closes only the editor that submitted it: replacing it with another editor or auxiliary route invalidates the old completion.

### CI limits fit a cold build and real retries

The evidence shows 10 minutes is too short for a cold build, with `apt` still unpacking at the limit. The build limit rises to 20 minutes, and `timeout-minutes` and `TERMINAY_CI_JOB_TIMEOUT_MINUTES` rise together to 30. A cold build is measured before these numbers are accepted. Warm runs are unaffected, and cold time stays in the budget report.

npm's `--fetch-retries` rises from 1 to 3 with 2 to 10 second backoff. The `npm ci` bound rises from 180 to 300 seconds and the bootstrap bound from 60 to 120, so the retries can actually run.

## Risks / Trade-offs

- [A failed save could block later saves] → The chain continues after a rejection, and each save still reports its own error.
- [Longer limits delay detection of a hung bot build] → The limit remains bounded and the watchdog still reports the step.
- [Other flakes remain] → The apply step re-measures the flaky list with retries off and fixes causes it finds.

## Migration Plan

No data or protocol migration. Rollback is a revert.

## Open Questions

None.
