## Context

See proposal.md for the defect. Generation liveness in remote access is meant to
rest on explicit signals — peer/ICE state, required-lane closure, reader end, and
the heartbeat bound. A hosted stall heuristic based on outbound traffic volume
sat beside those signals and could fire while the peer was healthy, because a
quiet PTY produces no outbound bytes at all.

## Goals / Non-Goals

Goals: make traffic pattern a diagnostic rather than a liveness signal, and pin
the behaviour with a regression test that keeps a peer open across five seconds
of silence.

Non-Goals: changing the heartbeat bound, the ICE `disconnected` grace period, or
any other explicit failure signal. Idle detection still exists at the
application-protocol layer through pings, which is where it belongs.

## Decisions

- Retain the stall detector but reduce it to logging. Deleting it outright would
  have lost the diagnostic signal that made the defect visible in the first
  place; forcing its decision to false keeps the observation and removes the
  authority.
- Keep hang-up authority exactly at user disconnect, required-lane loss, and
  WebRTC `failed`/`closed`.

## Risks / Trade-offs

A genuinely dead transport that emits no close event is no longer caught by the
stall path. That case remains covered by the heartbeat bound and by the server's
inbound-frame reaper, both of which are explicit signals.
