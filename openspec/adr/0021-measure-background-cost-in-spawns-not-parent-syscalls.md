# ADR-0021: Measure idle background cost in child processes, not in the parent's syscalls

Status: accepted
Date: 2026-09-15

## Context

ADR-0020 committed Terminay to treating externalised filesystem cost as cost:
work that leaves Terminay's own CPU flat while loading an endpoint-security
agent is a defect, and per-operation syscall budgets are asserted in tests.

That decision fixed what it measured. The main process's idle `getattrlist`
count fell from ~3,700 to 102 per 30 seconds, `stat64` from ~1,000 to 38, and
the settings and workspace-state rewrites stopped entirely. Microsoft Defender's
CPU use did not change, because the expensive work had moved into children:
about 8.6 spawns per idle second of `git status --untracked-files=all`,
`git diff --numstat`, `git rev-list --count`, `lsof` and `ps`. Defender still
burned ~45 seconds of CPU per 90 idle seconds. See
[idle subprocess spawn cost](./evidence/idle-subprocess-spawn-cost.md).

The measurement was the problem. `fs_usage` on a PID does not follow that
process's children, so the trace that proved the first fix could not have shown
this cost — and a budget asserted against that trace is satisfied by moving work
into a child. An `exec` is *more* expensive for an endpoint-security agent than
the syscalls it replaced: a fresh binary to authorise and scan, plus the same
tree walk, now invisible.

## Decision

1. **Idle background cost is measured in child processes spawned per second**,
   from the process table, not from a syscall trace of the main process. A trace
   of one PID is evidence about that PID only, and never evidence that work
   stopped.
2. **A performance claim names the instrument that would have caught the
   regression it is claiming to fix.** "Syscalls in the parent fell" is not a
   statement about system load.
3. **Spawning a process per sampling interval is a design error**, not a cost to
   be tuned. Where a long-lived stream can answer the same question — `lsof`
   repeat mode, an event subscription, a native call — it is preferred, and
   per-sample invocation is a fallback rather than the design.
4. **A debounce is not a rate limit.** A trailing debounce re-fires for every
   event spaced wider than its delay, so it bounds latency, not frequency. Work
   whose cost matters is bounded by a minimum interval between runs, set above
   the measured cost of one run so runs cannot queue behind one another.
5. **A feature that is switched off costs nothing.** "Off" means its scheduled
   work is cancelled, not that its results are discarded. Cancellation is by the
   identity that admitted the work, so a timer already in flight cannot race the
   flag.

## Consequences

- Performance changes in this area carry a spawn-per-idle-second figure taken
  from the process table. The previous change's figures were real but measured
  the wrong thing, and are not a precedent for how to evidence the next one.
- Fan-out is visible as a multiplier on that figure, which is what made the
  per-worktree fan-out legible at all: five worktrees, four commands, one event.
- Sampling loops must justify per-sample invocation against a streaming
  alternative. Existing loops are not grandfathered; they are the backlog.
- A native `proc_pidinfo` path would remove the `lsof`/`ps` spawn classes
  entirely. It adds a compiled dependency to the distribution matrix (ADR-0004),
  so it is a separate decision, not a silent consequence of this one.

## Open items

- Bound terminals sample topology at the base interval indefinitely: the
  widening back-off applies only to terminals that are still unbound, so a
  quiet bound terminal keeps spawning `lsof` and `ps` every 1.5 s. Widening it
  for bound terminals too would cut the dominant remaining cost, at the price of
  detecting a new subagent more slowly. That trade-off needs its own change and
  its own measurement, not a cadence tweak smuggled into a performance fix.

- `localAgentObservation` still shells out to `lsof` and `ps`. Streaming repeat
  mode reduces the rate; replacing them with `proc_pidinfo` and `proc_listpids`
  removes them, and needs its own ADR covering the packaging impact.
- The `~1.7 s` idle listing cadence noted in both reports remains unattributed.
