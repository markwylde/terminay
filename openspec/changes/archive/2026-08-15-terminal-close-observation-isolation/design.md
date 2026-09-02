## Context

See proposal.md. The defect was that one read path — the global activity
snapshot — silently carried a second responsibility, live host inspection of
every session, and a destructive control depended on it.

## Goals / Non-Goals

Goals:
- Foreground-process observation, activity projection, and close protection all
  obey the exact-session and bounded-work contracts.
- A close either completes within a bounded deadline or presents a safe,
  visible limited state.

Non-Goals:
- Deriving idle or busy from raw output.
- Widening terminal close checks to siblings, views, or the whole server;
  project and application close keep their documented scoped aggregation.
- Moving privileged process inspection out of the owning environment or host
  boundary.

## Decisions

**Separate projection reads from live observation.** `activity.snapshot` and
`activity.delta` return committed projection state and never start or await
host foreground-process inspection. Exact project filtering, ordered activity
events, and snapshot resynchronization semantics are preserved. This is the
core fix: a read stops being a trigger for unbounded work on unrelated
sessions.

**Observation is session-owned, bounded, and latest-wins.** Each exact session
has at most one running foreground sample plus one replaceable latest pending
sample. Continued PTY output supersedes obsolete pending work, so sampling can
never require complete output silence before the current sample settles. A
slow, failed, or unsupported observation is contained to its own session and
publishes only safe metadata and state.

**Availability is explicit, not inferred.** The projection carries
`available` / `limited` observation state per session rather than letting the
client guess from missing data. Idle and busy are still never derived from raw
output.

**Close asks about exactly one session.** Terminal-panel close uses an exact
`{serverId, projectId, sessionId}` close preflight, or an equivalent
server-owned command result, instead of a global refresh. Project close
aggregation stays limited to the project's canonical sessions.

**The unsafe default is refusal.** When target observation reaches its named
bounded deadline or is unavailable, the confirmation states the limited state
and defaults to **Keep Running**. The control never waits indefinitely and never
assumes idle from stale or missing data. Canonical workspace panel removal, PTY
termination, and confirmation behaviour are unchanged once the target decision
completes.

## Risks / Trade-offs

- Defaulting to **Keep Running** under a limited observation will occasionally
  ask about a terminal that was in fact idle. Accepted: a spurious confirmation
  is far cheaper than terminating running work.
- Latest-wins sampling can discard a sample that was nearly complete. Accepted:
  bounded, current information beats a stale sample that a noisy producer could
  keep alive indefinitely.
