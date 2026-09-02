## Context

See proposal.md. The change is a recovery from a set of related regressions
rather than a new feature, so its first slice was to restate the contract before
touching the implementation: creator-bound initial ownership independent of
attachment race order, conflict-only full-width takeover presentation, immediate
viewport fitting after ownership changes, and a transient reconnect that keeps
the connected workspace mounted.

## Goals / Non-Goals

Goals: deterministic ownership, a conflict indicator that is visible only during
an actual conflict and never obscures output, and a browser session that
distinguishes a transient reconnect from a credential failure.

Non-Goals: changing the lease model itself, or adding new presentation roles.

## Decisions

- **Ownership is acquired atomically during a write-authorized attach**, so
  which client attached first cannot decide who holds presentation. Later
  attachments are read-only and never steal from the holder.
- **The conflict bar is opaque and in layout flow.** An overlay would have hidden
  terminal content, which is the defect being fixed; being in flow costs a row
  of height and is the correct trade.
- **One wire command envelope for acquire, takeover, and renewal**, while
  preserving the handler result wrapper that revision-bearing presentation state
  requires. Collapsing the envelope without keeping the wrapper would have lost
  the revision.
- **A queued-write ownership rejection is a read-only handoff.** Classifying it
  as a transport failure crossed the boundary between presentation authority and
  connection health, and put presentation conflicts into transport-error
  recovery UI.
- **Terminal journal decoding is scoped to the exact attachment before
  validation**, keeping the terminal-session boundary a security boundary.
- **The canonical PTY emulator environment is pinned** rather than inherited from
  the host `TERM`, so behaviour does not vary with the environment the server
  happened to be launched from.
- **A transient reconnect generation keeps the connected workspace mounted.**
  Returning to enrollment is reserved for explicit exit or unrecoverable
  credentials, and repeated reconnect attempts must not flash the connection
  modal.

## Risks / Trade-offs

Keeping the workspace mounted through reconnect means a user can see a stale
painted surface briefly; that is bounded by the reconnect and hydration path and
is preferable to losing the session view on every blip.
