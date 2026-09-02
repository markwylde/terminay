## Context

See proposal.md for the defect. The failure was silent in three places at once:
the envelope and the snapshot shape disagreed, a cast concealed the
disagreement at compile time, and the event callback swallowed the validation
error at run time. Any one of those being loud would have surfaced the bug.

## Goals / Non-Goals

Goals:
- One shared, runtime-validated shape for snapshot and delta so client and
  server cannot disagree about it.
- Every reconciliation failure is observable and recovers deterministically.
- Convergence proven by executing the real cycle rather than by matching source
  text.

Non-Goals:
- Changing the workspace object model or the set of named commands.
- Adding polling as a recovery mechanism.

## Decisions

- **The envelope carries both the resulting scoped state and the ordered
  events.** Validating the two against each other catches a disagreement that
  neither alone would reveal.
- **Validation is a precondition of publication, not of consumption.** Server
  identity, schema, revision and cursor monotonicity, event bounds, scope, and
  references are all checked before anything is published, so a partially
  applied delta cannot mutate the UI projection.
- **Failure retains rather than discards.** An invalid or stale delta keeps the
  last confirmed projection and marks it stale, then performs exactly one
  bounded full-snapshot recovery. Retaining the projection keeps the workspace
  readable, and bounding the recovery to a single attempt avoids a polling loop
  against a server that is rejecting the client.
- **Changes arriving during a refresh are coalesced**, and the published
  revision may not regress or skip a committed mutation.
- **Tests execute the cycle.** Source-regex assertions were replaced with
  runtime tests covering initial snapshot, live create/close/move/activate,
  delta projection, concurrent changes, malformed delta, stale delta, resync,
  and scoped authorization, plus a two-client protocol test and a
  Docker-isolated Electron/browser end-to-end test run only through
  `npm run test:e2e`.

## Risks / Trade-offs

- Full-snapshot recovery is heavier than replaying a delta. It is bounded to one
  attempt per failure, which trades a larger single transfer for a guarantee
  that the client neither loops nor stays silently stale.
- Stricter validation can reject an envelope a previously lenient client would
  have partially accepted. That is the intended behaviour: a rejected envelope
  becomes a visible stale state and a recovery, not a half-applied projection.
