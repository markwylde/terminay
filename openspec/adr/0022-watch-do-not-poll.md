# ADR-0022: Watch for changes; never poll for anything a watch can observe

Status: accepted
Date: 2026-09-15

## Context

Two consecutive performance reports have described the same defect in different
clothing. ADR-0020 removed the main process's own polling loops; ADR-0021
recorded that the work had moved into spawned children and that the parent's
syscall count was never the quantity that mattered. Both changes tuned loops
that should not exist.

The loops keep coming back because nothing in the repository says they are
disallowed. A poll interval looks like a tunable, so a reviewer asks whether
1.5 s is the right number instead of asking why the code is asking repeatedly
at all. Every idle-cost defect found so far reduces to the same shape: work
scheduled by a timer rather than by the change it is looking for.

Two further facts sharpen this:

- The filesystem already reports its own changes. FSEvents and `fs.watch` give
  the exact signal the git and explorer loops were sampling for, so those polls
  are not a trade-off — they are redundant work that also misses changes between
  ticks.
- A debounce is not a rate limit. A trailing debounce re-fires for every event
  spaced wider than its delay, which is how a 120 ms delay in front of a 0.28 s
  command free-ran. Bounding cost needs a floor between runs, not a delay after
  the last event.

Agent observation looked like an exception and is not one. Every piece of agent
data is already a file: the provider reads `~/.claude/sessions/<pid>.json` and
the session journal, and watches both. `ps` is used for exactly one thing —
obtaining the `claude` PID — and that PID is the *filename* `<pid>.json`. The
process table is being scraped to learn the name of a file sitting in a
watchable directory. `lsof` is not used by the provider at all; it belongs to
the host's 1.5 s topology signature, which exists only to decide when to re-run
discovery.

So the ~97% of idle spawns are not buying anything a directory watch cannot
give: a new `<pid>.json` appearing *is* the discovery event.

## Decision

1. **Polling is not permitted for any state a watch can observe.** Filesystem,
   directory, and file-content changes are observed through FSEvents /
   `fs.watch` / an equivalent host subscription. A timer that re-reads the same
   path to see whether it changed is a defect, not a configuration choice.
2. **Work is scheduled by the change, then damped.** A watch event schedules the
   work behind a ramping schedule: run after 1 s; while changes keep arriving,
   widen to 2 s, 3 s, 5 s, 10 s, 20 s and hold at 20 s. A quiet period resets to
   1 s. Events arriving inside an interval collapse into exactly one run at its
   end, so nothing is dropped and the rate is bounded however the events arrive.
3. **The ramp sits on a floor, not on a delay.** The interval is a minimum time
   between runs. The first event after a quiet period runs promptly — the case a
   user is watching — and sustained churn is what widens.
4. **Agent discovery is driven by watching its files.** A new session file
   appearing in the agent's sessions directory is the discovery event. Process
   identity is confirmed once, at bind time, against the terminal's own
   descendants — never on a repeating interval. Neither `ps` nor `lsof` may run
   on an idle path.
5. **Reading a process table to learn a filename is prohibited.** If the only
   thing wanted from a process snapshot is a key into a file, watch the
   directory that file lives in.
6. **A feature that is switched off schedules nothing**, whether it watches or
   samples. Carried forward from ADR-0021 because it is the same rule.

## Consequences

- New work that wants a timer has to argue against this record. "What interval?"
  is the wrong review question; "what change are you waiting for?" is the right
  one.
- The git worktree status poll (10 s) and the Dockview reconcile loop (500 ms)
  are now defects with a stated fix, not accepted behaviour. Neither is opt-in.
- Agent topology sampling (1.5 s) becomes a defect with a stated fix rather
  than accepted cost. `agentIntegration` defaults to enabled, so every user pays
  it by default.
- PTY foreground sampling is the only residual poll. It reads the terminal's
  foreground process group from a file descriptor the app already owns — one
  `tcgetpgrp` ioctl, no spawn, no scan — so it is cheap, but it is still a poll
  and is recorded as such rather than quietly excused.
- No native addon is required. An earlier draft of this record claimed process
  state could not be watched and proposed kqueue `EVFILT_PROC` with its
  ADR-0004 packaging cost. That was wrong: the data was always in files.
- Ramping is shared behaviour, not per-call-site cleverness. One schedule
  implementation, used everywhere, so the ramp cannot be subtly different in
  each place that needs it.

## Open items

- Convert the git worktree status poll to a watch on `.git/HEAD`, `.git/index`,
  `.git/refs`, and the working tree.
- Convert the Dockview reconcile loop to a `MutationObserver`.
- Convert agent discovery to watching the sessions directory, removing `ps` and
  `lsof` from the idle path.
- Decide whether PTY foreground sampling can be driven by shell integration
  rather than sampled.
- Extend the existing minimum-interval schedule to the 1/2/3/5/10/20 s ramp and
  route every damped site through it.
