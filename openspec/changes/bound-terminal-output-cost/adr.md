# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-07
- Reviewer: Claude (for Mark Wylde)
- Change: bound-terminal-output-cost

## In-Force ADR Context Reviewed

Derived by walking `Supersedes:` links across `openspec/adr/`. ADR-0001, 0004,
0007, 0008, 0009, 0010, 0014, 0022, 0024, 0030 and 0032 are superseded and were
not treated as live commitments. Every other record from 0002 to 0040 is in
force. The binding ones here:

- openspec/adr/0028-no-polling-without-owner-approval.md - decision 5 requires
  work that follows an observed event to run behind the one shared ramp, which
  is why output-driven foreground sampling uses `createRampSchedule` and not a
  new interval. Decision 6 is why the ramp is owned and disposed by the
  session's observer. Its open item on PTY foreground sampling (the 1500 ms
  interval) is left for the owner; this change adds no poll and removes none.
- openspec/adr/0021-measure-background-cost-in-spawns-not-parent-syscalls.md -
  spawns per second from the process table is the instrument used for the `ps`
  finding; rule 4 (a debounce is not a rate limit) rules out a trailing
  debounce. Honoured, not amended.
- openspec/adr/0035-detached-session-holder-owns-ptys.md - the packaged app
  reads PTYs through the session holder, so the fix and its test cover the
  holder adapter as well as the in-process one. The holder process and its
  protocol are not changed.
- openspec/adr/0011-security-trust-boundary-model.md - terminal-session
  identity is a security boundary. Retention and observation stay per session;
  no bytes or samples cross sessions or projects that did not before.

## Repository-Level ADRs Created

- openspec/adr/0044-output-path-work-is-proportional-to-the-output-event.md -
  per-output-event work is sized by the event; a size bound is not a work
  bound; expensive follow-up goes behind the shared ramp; cost is asserted by
  scaling tests and evidenced as process CPU. Supersedes nothing.

## Notes

- Supporting measurements:
  openspec/adr/evidence/terminal-output-main-process-cost.md, with the harness
  that produced them beside it.
- Not recorded as ADRs: the shape of the bounded chunk queue and keeping the
  authority's copy separate from the service's replay. Both are implementation
  choices inside ADR-0044's rule; the second is listed there as an open item.
- `openspec/adr/README.md` has no index row for ADR-0040. Left as found.
