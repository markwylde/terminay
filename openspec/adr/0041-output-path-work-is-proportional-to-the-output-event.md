# ADR-0041: Work on the terminal output path is proportional to the output event

Status: accepted
Date: 2026-10-07

## Context

A PTY callback crosses the server synchronously: it is retained in the
session's replay, fed to the presentation checkpoint, and fanned out to every
listener. For a shell that is a few events per command. For a full-screen TUI
it is 300–450 events a second for as long as the program is on screen, which
for an agent session is hours.

On that path, three pieces of code did work per event that was sized by
something other than the event: the megabyte of output already retained, the
number of chunks already retained, and the host's process table. Each was
harmless when written and tested against a shell. Together they held the main
process at 32% CPU and ran `ps` forty times a second under one TUI. Removing
them left 2.7%. See
[terminal output cost in the main process](./evidence/terminal-output-main-process-cost.md).

Two things made this hard to see. Nothing was unbounded — every buffer had a
limit and every sample was coalesced — so each site looked correct in review.
And a profile of the JavaScript thread put the worst offender at 2.5%, because
the cost of allocating 600 MB a second lands on collector threads and in the
kernel.

ADR-0021 and ADR-0028 already govern work that is scheduled: no polling, one
shared ramp behind observed events, cost measured in spawned children. Neither
says anything about work done inline, per event, on a path whose event rate
the server does not control.

## Decision

1. **Per-output-event work is proportional to that event's bytes.** Code that
   runs for each PTY callback, in the terminal service, a PTY adapter, or any
   listener of terminal events, must not do work proportional to output already
   retained, to the number of retained chunks, to the number of sessions, or to
   host state.
2. **A bound on size is not a bound on work.** A retained structure keeps its
   limit incrementally — a running total, constant-time eviction — and is
   assembled into a contiguous value only when read.
3. **An output event is evidence, not a unit of work.** Anything costlier than
   handling the bytes — a process spawn, a host query, a file read, a
   serialisation — is requested through the shared ramp (ADR-0028 decision 5)
   and never executed once per event. A caller that needs a fresh answer for a
   decision asks for one explicitly and is not behind the ramp.
4. **Cost on this path is asserted by scaling, and measured as process CPU.**
   A test builds two instances that differ only in the quantity that must not
   matter and asserts the per-event cost ratio, or counts expensive operations
   against elapsed time. A claim about this path's cost is evidenced with
   whole-process CPU under a sustained repaint workload, not with a
   main-thread profile alone.

## Consequences

- Review of anything on the output path asks "what does this cost when it runs
  400 times a second against a full replay?", and "bounded" is not an answer.
- A new terminal-event listener that needs retained output reads it on demand
  rather than accumulating its own copy per event.
- Scaling tests are slower than unit tests (they fill a megabyte first) and
  compare timings. They use best-of-several and margins an order of magnitude
  inside the defect they guard, and assert no absolute duration.
- The measured remainder on the path — presentation checkpointing, per-listener
  copies, the activity reducer — is proportional to the event and is left as it
  is. This record is not a mandate to rewrite it.

## Open items

- The desktop authority keeps its own copy of recent output beside the terminal
  service's replay. Both now conform, but it is still two copies of the same
  bytes. Serving the authority from the service needs retention after exit and
  an exact-tail read specified first.
- Recordings and activity parsing decode each event with a fresh,
  non-streaming `TextDecoder`. That is proportional to the event, so it
  conforms, but it corrupts a multi-byte character split across two events.
  It is a correctness defect for its own change.
