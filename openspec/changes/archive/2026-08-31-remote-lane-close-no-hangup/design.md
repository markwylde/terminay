# Design

## Context

See `proposal.md`. A single auxiliary lane closing is not by itself proof that the
transport is gone: ICE can still report a connected peer, and the application lane can
still be delivering. Treating any lane close as a hangup discarded live sessions and
server-owned PTYs for a recoverable condition.

## Decisions

- Gate hangup on the ICE connection state rather than on lane state alone. While ICE is
  connected, a `control` or `assets` close is a warning, not a teardown.
- Keep the event observable: the diagnostic names the channel and records
  `hangup: false`, so a lane close is still visible in traces without implying a peer
  failure.

## Risks / Trade-offs

- A genuinely dead transport whose only symptom was a lane close is no longer detected
  by that signal. The existing ICE state and heartbeat bounds remain the liveness
  signals that catch it.
