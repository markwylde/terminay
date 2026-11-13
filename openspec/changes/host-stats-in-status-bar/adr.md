# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-13
- Reviewer: Claude (for Mark Wylde)
- Change: host-stats-in-status-bar

## In-Force ADR Context Reviewed

Depth of review: every ADR from 0001 to 0110 was screened by title; the ones
below were read and engaged.

- ADR-0028 (never poll without owner approval): host counters have no event
  source. The poll was approved by the owner on 2026-11-13 and is recorded in
  `design.md` decision 1. It is owned by its subscriptions and torn down with
  them.
- ADR-0021 (measure background cost in spawns): Linux sampling spawns nothing;
  macOS spawns one shell per sample only while watched.
- ADR-0018 (one workspace bundle, many server connections): stats follow the
  active tab's server, and the client's sample buffer resets with the server.
- ADR-0011 (security trust boundary model): a sample is aggregate host data
  with no identities, paths or addresses, gated by read scope.
- ADR-0085 (Win32 APIs through koffi): not used. Windows network and disk
  counters are deferred, not built on a new native path here.

## Repository-Level ADRs Created

- None. The poll approval is recorded in the change design, as ADR-0028
  requires, and the change introduces no new durable architectural rule.

## Notes

The highest ADR sequence number in use is 0110.
