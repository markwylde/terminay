# Handover

Read this before touching the branch. It corrects a PR description and a task
list that were both overstated.

## What we are trying to do

The user reported: **a running Claude Code session shows no status indicator on
its terminal tab.** Grok and Codex worked; Claude Code showed nothing.

The intended end state is a written, testable capability matrix across agent
providers, and — crucially — **integration tests that drive each provider's real
CLI and prove the matrix**, rather than fixtures that encode our beliefs about a
CLI's file format.

The user's requirements, stated repeatedly and explicitly:

- Yellow while an agent is working, green when it stops, red when it needs input.
- A matrix of scenarios per provider: Detect, Title, Idle, Working, Waiting,
  Blocked, Done, subagent enumeration, subagent status, Resume.
- Tests **inside each extension package** that spawn the real CLI, give it a
  multi-subagent prompt, and check every scenario as it runs, including quitting
  and resuming a session.
- No hooks, no CLI configuration changes, no wrappers. File-based observation only.

## Current state, honestly

**The original bug is not fixed.** The user launched `claude` resuming an
existing session on this branch. It does not appear in the sidebar. Sending a
message did not make it appear.

**The application was never run during this work.** Not once. Every claim of
"fixed" was inferred from unit tests.

**No conformance test has ever executed.** They are gated behind opt-in
environment variables and skip by default. A previous summary reported
`skipped 1, fail 0` as "green". Skipping is not passing. Every `Y` in the
published matrix is backed by a test that has never run.

**CI is red on two jobs:**

1. `Build, lint, and unit tests` — `npm run smoke` fails at
   `scripts/check-workspace-boundaries.mjs`:
   `packages/agent-conformance/src/harness.ts` imports `@terminay/server-core`,
   which only `@terminay/server` may import. There were also three lint errors;
   fixes for those were written and then discarded with the rest of an abandoned
   refactor (see below).
2. `Packaged Linux built-in lifecycle` — not investigated.

There is a second, unreported boundary violation of the same kind: extensions
may import only `@terminay/extension-api`, and each
`extensions/*/test/conformance.test.mjs` imports `@terminay/agent-conformance`.

**An abandoned refactor was discarded.** Mid-session the harness was being moved
from `packages/agent-conformance` to `e2e/agent-conformance` to satisfy those
boundary rules. That move was incomplete and left the conformance tests unable to
even load. It has been reset so the branch sits at exactly the pushed commit
`3030c2a7` with a clean tree. The relocation still needs doing, or the boundary
rules need an explicit, argued exception.

## What is genuinely done and verified

These were implemented and proven by tests that were written **and run**:

- **Claude Code binding.** The provider previously bound only via a journal held
  open for writing; the real CLI appends and closes and holds no such handle
  (verified with `lsof` against live processes). Discovery now resolves the
  project directory from the descendant process CWD and admits a root written
  after that process started, selecting the one currently receiving appends when
  a process has several conversations. Unit tests pass with `openFiles` empty.
- **Claude Code lifecycle mapping.** Per-turn header records no longer restart
  the session each turn. `AskUserQuestion` is no longer treated as a live
  `waiting` signal — the CLI flushes an assistant record together with its
  `tool_result` only on completion, so that record appears *after* the question
  is answered (verified against a live mid-turn journal: 66 tool calls, zero
  outstanding).
- **OpenCode provider.** New SQLite-backed provider, read-only, reading only
  lifecycle columns. Verified by replaying a real store: 15 turns, 10 permission
  waits, 10 tools, no conversation payload leakage.
- **Grok subagents.** Verified by actually running `grok --always-approve -p`
  with a multi-subagent prompt and polling the filesystem. Children are
  `<session>/subagents/<subagent_id>/meta.json`, written `running` at spawn and
  rewritten `completed`, carrying an explicit `parent_session_id`. One child
  completed at t=30s while another ran until t=70s.
- **Unit suites.** claude-code 45, codex 16, grok 27, opencode 17, extension-api
  70, server-core 749 — all passing. None of them touch the running product.

## Four times a spec was written from documentation instead of behaviour

This is the recurring failure and the reason the conformance suite exists. Each
was only caught because the user pushed back:

1. Claude Code was bound to open-handle evidence its CLI never presents.
2. Grok was documented as unable to report subagent status; its CLI had gained it.
3. Grok subagent support was implemented against `subagent_progress` /
   `subagent_finished`, taken from strings in the binary. Those records do not
   exist. Grok writes exactly 16 event types and neither is among them.
4. OpenCode's `blocked` rule would have shown every user-cancelled turn as red:
   77 of 99 recorded errors on a real store are `MessageAbortedError`.

## What to do next, in order

1. **Run the app and reproduce the bug.** `npm run dev`, resume a `claude`
   session, watch the sidebar. Everything else is guesswork until this is done.
   The most likely gap: `claude --resume <uuid>` takes the explicit-resume path
   in `extensions/agent-claude-code/src/provider.ts`, which requires exactly one
   matching descendant and a header whose `sessionId` equals the requested UUID.
   That path is unchanged from `main` and was never exercised against a real
   resumed session.
2. **Restore `e2e/real-codex-agent-runtime.spec.ts`** (recoverable from `main`).
   It was deleted under task 8.6. It is the only test in the repository that
   drove the real app with a real CLI and asserted the Agents sidebar. Deleting
   it made real-app coverage worse than `main`, and its replacement neither runs
   nor looks at the UI.
3. **Fix the two boundary violations** so `npm run smoke` passes, then
   `npm run test:ci` before any push.
4. **Actually run one conformance test end to end** against a provisioned CLI.
   Until one has run, treat the matrix as unproven.
5. **Re-audit the matrix.** Codex's `waiting` and `blocked` are unverified: no
   rollout on this machine (3,309 checked) contains an approval request, because
   every local session ran with approvals bypassed. Claude Code's `blocked`
   rests on `isApiErrorMessage`, a field present in real records but never
   observed set.

## Files worth reading first

- `openspec/changes/agent-provider-status-conformance/tasks.md` — now audited;
  unticked items carry a note saying exactly what was not done.
- `openspec/changes/agent-provider-status-conformance/decisions.md` — decisions
  taken mid-implementation, including one (task 2.5) where the implementation
  deliberately diverges from the task text.
- `docs/agent-provider-capabilities.md` — the published matrix. Its "What has
  been confirmed against a real CLI" section is accurate; the table above it
  overstates confidence for the cells named there.
- `openspec/adr/0014-declared-provider-capabilities-proven-against-real-clis.md`
  — the principle this work violated.

## Do not trust

- The PR description on #215. It claims 45/45 tasks and green tests.
- Any statement in the PR or prior summaries that the original defect is fixed.
- The matrix as a statement of verified fact. It is a statement of intent with
  unit tests behind some of it.
