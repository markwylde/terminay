# ADR-0041: A liveness deadline counts only time the side measuring it was running

Status: accepted
Date: 2026-10-07

## Context

Terminay decides that a peer is gone by deadline: the server closes a
connection whose client promised a heartbeat and then sent nothing for 60 s,
and a client retires a transport generation after two probes go unanswered
within their interval. Both are timers, and both assumed that when a timer
fires, the peer has had that long to act.

That assumption fails across a suspension. On 2026-10-07 a laptop slept for ten
minutes. On wake the server's deadline was already overdue, so it closed a
healthy embedded connection before the window had run a single line of code.
Ten minutes earlier, as the machine went to sleep, the window had retired a
healthy connection on its own heartbeat the same way. A request made just after
wake was lost and the window became unusable
(`openspec/changes/survive-wake-connection-reap/`).

Machines sleep, containers are paused, browser documents are frozen, and
debuggers stop processes. Any deadline that treats its own downtime as the
peer's silence will misfire in each of those cases, and more liveness deadlines
will be written.

Three ways to handle it were considered:

- Have the host report suspend and resume to whatever owns a deadline. Only
  Electron has such a signal; the standalone server and a browser tab do not,
  and it would route an OS event across the privileged boundary.
- Measure deadlines on a monotonic clock that stops during sleep. Runtimes and
  operating systems disagree on whether their monotonic clocks advance while
  suspended, so behaviour would vary by platform.
- Let the deadline detect its own lateness.

## Decision

1. **A liveness deadline measures the peer only while the measurer was
   running.** Code that retires a peer, connection, lease, or generation
   because a deadline elapsed must be able to tell a deadline that ran its
   course from one that came due while its own process was suspended.
2. **Lateness is read from the timer that fired.** Record the wall-clock time
   when the deadline is armed; when it fires, an elapsed time that exceeds the
   deadline by more than a small tolerance means the measurer was not running.
   No watchdog, tick, or other additional timer is introduced for this, which
   keeps it within ADR-0028.
3. **A suspended deadline is replaced, not honoured.** The measurer grants one
   fresh deadline, or asks again immediately, and retires the peer only if that
   one elapses while it was running.
4. **The rule may only delay a retirement, never hasten one.** A clock step or
   stall that looks like a suspension costs one extra deadline. Nothing may
   cause a peer to be retired sooner than the deadline it was promised.

## Consequences

- A sleep of any length does not cost a healthy connection on any host or
  transport, and the rule is the same on the server and in every client.
- A peer that died during a suspension is retired one deadline later than it
  would have been. Resources scoped to that connection are held for that long.
- A machine that wakes only briefly and repeatedly can keep a dead peer
  attached until it stays awake for one full deadline.
- Deadlines that are not about liveness — request timeouts a caller is waiting
  on, token expiry, scheduled work — are outside this rule. Expiry in
  particular must still honour wall-clock time across a sleep.
