## Context

See proposal.md. The defect was structural rather than incidental: two
independent callbacks each held the authority to close a connection, so neither
could take a recoverable view of the other's state.

## Goals / Non-Goals

Goals:
- An authenticated browser workspace survives a recoverable ICE interruption on
  its original peer, application channel, and terminal channel.
- A connection closes exactly once, and only when recovery is genuinely
  terminal.

Non-Goals:
- Recreating a PTY, an application session, or an authenticated peer as part of
  recovery.
- Changing permanent-failure or revocation behaviour.

## Decisions

**One authority per connection.** Peer state and ICE state are inputs to a
single connection-scoped evaluator instead of two independent close triggers.
This is what makes "recoverable" expressible at all: neither callback alone
knows whether the other has already gone terminal.

**Recoverable `disconnected` gets one bounded grace period.** Entering
`disconnected` starts exactly one timer, and returning to health cancels it.
Explicit `failed` or `closed` skips the grace period and closes immediately.

**Close is published exactly once.** Grace-period expiry publishes one close.
Normal host cleanup cancels a pending recovery without publishing a second
close, so teardown cannot double-report.

**Recovery reuses the existing authenticated peer.** Nothing is re-established:
the same application and terminal channels continue. This keeps the change
strictly inside the transport lifecycle and away from the authentication and
session boundaries.

## Risks / Trade-offs

- A grace period delays the visible failure of a genuinely dead connection by
  its bounded duration. Accepted: a bounded delay is preferable to tearing down
  a live workspace on a transient ICE blip.
- Recovery must not mask revocation. Immediate permanent-failure and revocation
  behaviour was explicitly preserved and covered by regression tests.
