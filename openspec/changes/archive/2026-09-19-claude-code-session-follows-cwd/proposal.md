## Why

A Claude Code session that changes its working directory mid-conversation —
`EnterWorktree`, `ExitWorktree`, or any tool that moves the CLI's cwd — freezes
its Agents row at whatever state it had at that moment. On 2026-09-16 a session
that entered a worktree at 17:59:24Z showed WORKING for the rest of its life:
it ran a 17-minute turn, went idle, was resumed by a background task, and went
idle again, and the row never moved. Touching, rewriting, and force-reloading
changed nothing, and nothing was logged.

The provider watches the pid-keyed session file for status changes, but
accepts a rewritten file only when its `cwd` still equals the process cwd
captured at binding. The CLI rewrites the file with the new cwd, so every
later read is rejected and the status lane goes silent. At the same moment the
CLI moves the journal to the project directory for the new cwd, so the
follower on the old path closes. The binding stays alive with no lane behind
it.

## What Changes

- While bound, a rewrite of the session file whose `pid` and `startedAt`
  still match the observed process is accepted whatever its `cwd` says. The
  bind-time rule is unchanged: a file binds only when its `cwd` equals the
  observed process cwd.
- A change of `cwd` for the same `sessionId` is a journal relocation. The
  provider resolves the journal again for the new cwd, by the same rule that
  resolved it at binding, and follows it from its start. The mapping keeps its
  state across the relocation, so the replayed history re-opens nothing and
  records the CLI appends after the move are projected as before.
- The status word is compared against the last word the provider saw, so a
  status change written together with the cwd change is not lost.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-status-and-sidebar`: the Claude Code mapping requirement — the
  session file's `cwd` is data after binding, and the bound journal follows it.

## Impact

- `extensions/agent-claude-code/src/provider.ts` — `acceptSessionFile`,
  `renamedSessions`, `rootSource`.
- `extensions/agent-claude-code/src/mapping.ts` — a relocation record the
  provider injects ahead of the replayed journal.
- `extensions/agent-claude-code/test/relocation.test.mjs` — reproduces the
  freeze against the old code and holds the new behaviour.
- No host, protocol, extension API, or client surface is touched.
