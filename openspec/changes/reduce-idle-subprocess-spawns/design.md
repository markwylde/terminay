## Context

The previous change (`reduce-idle-filesystem-churn`, ADR-0020) removed the main
process's own idle polling. The syscall counts for the parent fell by roughly
97%, and the reporter confirms those loops are gone. The endpoint-security cost
did not fall with them, because the expensive work is done by children:
`git status`, `git diff`, `git rev-list`, `lsof`, `ps` — about 8.6 spawns per
idle second.

That is the lesson worth carrying: **the parent's syscall count was never the
quantity that mattered.** A `fs_usage` trace of the main PID cannot see a
child's work, so optimising against that trace optimises against a proxy. The
quantity an endpoint-security agent actually charges for is `exec` calls and
the tree walks behind them, and it must be measured from the process table.

Three independent mechanisms produce the spawns:

1. `gitDiffService.ts:294` maps over every worktree and issues four commands
   each. Five worktrees cost ~20 spawns, and a change in any one of them
   triggers the whole fan-out.
2. `useFileExplorerController.ts:31` sets a 120 ms trailing debounce on
   `subscribeStatusChanges`. A trailing debounce re-fires for every event
   spaced wider than its delay; a single `git status --untracked-files=all`
   takes 0.28 s here, so the debounce is far shorter than the work it
   schedules and free-runs at ~8 Hz.
3. `ExtensionAgentRuntime` contains no reference to the agent-integration
   setting — verified by grep, it is simply absent — so `agentService`
   disabling integration clears its own maps while the runtime's topology
   timers keep polling, spawning `lsof` and `ps`.

**Boundary this crosses:** ADR-0011 places agent observation and Git services
behind the server's trust boundary, with terminal-session identity as a
security boundary. Gating observation must cancel work per terminal *by
identity*, not by a global flag that a stale timer can race past.

## Goals / Non-Goals

**Goals:**

- Cut spawns per idle second, measured from the process table.
- Make the disabled agent-integration setting actually cost nothing.
- Keep every refresh correct: fewer commands, not staler results.

**Non-Goals:**

- Replacing `lsof`/`ps` with a native `proc_pidinfo` addon. That is the right
  end state — `PROC_PIDVNODEPATHINFO` returns a cwd directly, which is what
  `lsof -d cwd` computes the expensive way — but it adds a compiled dependency
  to the packaging matrix (ADR-0004) and belongs in its own change.
- `--untracked-files=normal`. The reporter measured it only marginally cheaper
  here, and it changes which files the panel reports. Not worth coupling to a
  performance fix.
- The `~1.7 s` listing cadence from the previous report, which remains
  unattributed.

## Decisions

### Scope a refresh to the worktree that raised it

`git.status.changed` already carries worktree IDs, so the event has the
attribution needed. The panel refresh takes an optional worktree filter; when
present, only that worktree's four commands run and the other worktrees' last
known entries are carried forward. Unattributed refreshes — first load, root
change, resubscribe — still query everything, so nothing goes stale after a
change the event stream could not attribute.

**Alternative considered:** caching per-worktree results with a TTL. Rejected:
it keeps the fan-out and adds a staleness window, where scoping removes the
work outright.

### Bound the cadence with a minimum interval, not a longer debounce

The report suggests raising the debounce to ~1000 ms, which would work. A
larger trailing debounce is still the wrong shape though: it delays every
isolated event by the full delay, and it still re-fires at the debounce
frequency for any trickle spaced wider than it.

Instead the refresh is throttled — the first event after a quiet period
refreshes promptly, and further events collapse into exactly one refresh at the
end of a minimum interval. That is both more responsive for the isolated case
and strictly bounded for the sustained case. The interval is set above the
measured cost of a refresh so refreshes cannot queue behind one another.

### Gate observation in the runtime, and cancel by identity

`AgentService.setIntegrationEnabled` gains a runtime observer so the flag
reaches `ExtensionAgentRuntime`. Disabling cancels each tracked terminal's
timers and retires its context through the existing release path, so the
cancellation goes through the same identity checks admission does. Re-enabling
re-registers live terminals, which `applyAgentIntegrationSetting` already does
for the service.

**Why not a flag checked inside the poll callback:** a timer that has already
fired races the flag, and the poll would still have spawned. Cancelling the
timers is what makes the disabled cost actually zero.

### Streaming `lsof` is attempted, with a fallback that keeps the contract

`lsof -r<n>` runs once, emits an `m` marker per cycle, sleeps and repeats, so a
fixed terminal set costs one process instead of one per sample. `-p` is fixed
at launch, so the stream restarts when a terminal opens or closes — far rarer
than the sampling interval.

This is the riskiest item here: it introduces a long-lived child with its own
lifecycle, and a parser that must resynchronise on markers. The spec therefore
requires streaming *where available* and keeps per-sample invocation as a
conforming fallback, so a host where the stream cannot start degrades to
today's behaviour rather than losing observation. If the streaming path cannot
be made reliable within this change, the fallback is what ships and the
requirement is still met.

## Risks / Trade-offs

- **A scoped refresh misses a change in another worktree** → Only events that
  name a worktree are scoped; anything unattributed still refreshes everything.
  The panel's other entries are carried forward from the last full refresh
  rather than cleared.
- **The minimum interval makes the panel feel stale** → The first event after a
  quiet period is not delayed, which is the case a user actually watches
  (saving a file and looking at the panel). Only sustained churn is throttled,
  and that is the case where per-event accuracy is worthless anyway.
- **Cancelling observation on disable loses a binding that was mid-discovery**
  → Re-enabling re-registers live terminals and discovery starts a fresh
  window, which the existing `Discovery windows and retries` requirement
  already covers.
- **A long-lived `lsof` holds resources or goes stale** → It is restarted on
  terminal-set change and killed on teardown; if it exits unexpectedly the
  sampler falls back to per-sample invocation rather than reporting nothing.
- **This change is measured by a different instrument than the last one** →
  Deliberately. Spawn counts come from the process table; a syscall trace of
  the parent is what hid this regression, and the task list says so explicitly.

## Migration Plan

None. No stored data, protocol field, or setting changes shape. Revertible by
reverting the commits.

## Open Questions

- None blocking. No in-force ADR needs revisiting: ADR-0011's identity-bound
  cancellation is honoured rather than amended, and the native-addon direction
  is left to a future change rather than taken here.
