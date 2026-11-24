# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-24
- Reviewer: Claude (Opus 5.5)
- Change: git-watch-stays-accurate

## In-Force ADR Context Reviewed

- openspec/adr/0028-no-polling-without-owner-approval.md: no timer may
  replace a watch. Unobservable state is measured on demand. Re-arming happens
  only on a client request, so it complies.
- openspec/adr/0114-git-watches-never-walk-a-tree-on-the-event-loop-and-skip-what-git-ignores.md:
  the Linux built-up watch, its directory ceiling, and failure into on-demand
  measurement. This change keeps all of that and only stops treating a vanished
  root as a loss of coverage.
- openspec/adr/0052-terminals-report-git-commands-to-the-server-through-git-trace2.md:
  checked as an alternative signal for pushes. It isn't used, because pushes
  from outside Terminay terminals have to be seen too.
- openspec/adr/0022-watch-do-not-poll.md: superseded by 0028. Historical
  context only.

## Repository-Level ADRs Created

- openspec/adr/0141-a-watched-root-that-goes-away-is-a-removal-and-lost-git-observation-re-arms-on-request.md:
  for Git observation only, a working-tree watch whose root goes away is a
  change, not a failure. Only a real loss of coverage makes observation
  unavailable, and unavailable observation re-arms only on a client request.

## Notes

ADR-0141 refines what ADR-0028 and ADR-0114 call a failure and doesn't reverse
either, so it supersedes neither. The rule that status-change publication
follows every listed value is a behavioural contract, recorded in the delta
spec, not an ADR. Watch readiness (design Decision 3) makes the existing cache
contract hold rather than introducing a new architectural commitment, so it is
also recorded only in the spec.
