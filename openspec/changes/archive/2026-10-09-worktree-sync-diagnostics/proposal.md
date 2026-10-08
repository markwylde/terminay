## Why

A worktree row in the Git pane kept showing `+11k −254` for about eleven minutes
after its branch had been merged and the default branch pulled. Resizing the
sidebar and re-selecting the project root did not correct it; it corrected
itself only when something unrelated touched that worktree's Git directory.
Nothing was written to the Diagnostics folder at any point, so the cause could
not be established afterwards.

The Git service observes repositories with filesystem watches and answers
listings from a cache it trusts while those watches report no change. Every
step of that chain is silent: a watch that fails discards its error, an
observed change leaves no trace of how it was attributed, a measurement leaves
no trace of which worktrees it re-measured and which it carried forward, and a
listing answered from cache is indistinguishable from a measured one. The same
merge-then-pull sequence refreshes correctly against the real service outside
the packaged app, so the failure cannot be found by reading the code — it has
to be captured when it happens.

## What Changes

- The Git service reports its observation lifecycle to the server host: each
  watch opened, closed, and failed (with the error it currently discards);
  observed changes summarised by entry class and the scope they invalidated;
  each measurement's claim, the worktrees it re-measured and carried forward,
  its duration and outcome; listings answered from cache; and status-change
  events published or suppressed.
- Desktop records those reports in the diagnostic history for the embedded
  Local server. A standalone server writes them to its own service log.
- The Git pane records each synchronisation outcome — what triggered it,
  whether it was scoped, and whether it was applied, superseded, or failed —
  through the renderer evidence Desktop main already observes.
- A listing requested by an explicit user refresh or a project-root change is
  always measured rather than answered from cache, and a difference between
  the measurement and the cache it would otherwise have served is recorded as
  a cache mismatch. This is the only change to refresh behaviour, and it is
  what turns "the pane was stale" into a recorded event naming the row.
- A test exercises the real filesystem watcher against a real repository
  through a default-branch move, which the existing fake-watcher tests cannot
  cover.

No record carries a project root, repository or worktree path, ref or branch
name, project id, or Git output. Repositories and worktrees are identified by
process-local diagnostic ids.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `local-desktop-diagnostics`: adds always-on coverage of Git observation
  lifecycle and Git pane synchronisation, with the identifiers and bounds those
  records use.
- `git-worktrees-and-quick-push`: adds the Git service's obligation to report
  its observation lifecycle to the server host, and the rule that an explicit
  refresh or root change is measured rather than served from cache.

## Impact

- `packages/server-core/src/gitService/` — observer option, report points in
  the observation and measurement paths, a forced-measurement request flag.
- `packages/client-core/src/gitClient.ts`, `packages/server-core/src/gitService/adapter.ts`
  — the worktree-list request carries the optional forced-measurement flag.
- `electron/serverTerminalAuthority.ts`, `electron/main.ts` — route reports to
  Desktop diagnostics on the lifecycle channel.
- `apps/terminay-server/src/cli.ts` — write reports to the service log.
- `src/workspace/useFileExplorerController.ts` — sync outcome evidence, and the
  forced flag on explicit refresh and root change.
- Tests in `packages/server-core/test/` and `scripts/`.
- No new dependency, no persisted-state change, no protocol version change.
