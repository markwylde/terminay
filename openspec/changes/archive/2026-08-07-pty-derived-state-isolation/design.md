## Context

See proposal.md for the user-visible failure. The confirmed reproduction was resuming Codex
session `019fd3bb-defc-71e1-a5d6-c2f8171d5663`, which reliably closed the Local renderer
connection with `connection outbound queue limit reached`. Raw terminal bytes already used
an attachment lane; the pre-provider raw activity updates did not. The personal Codex
rollout used to find this is a manual fixture and is not committed, so the permanent
regression models its production event shape without retaining user content.

A post-merge regression widened the scope. The first implementation isolated raw terminal
output and activity state but left other subscription events on the fatal reliable control
queue. Codex journal replay publishes full `agent` snapshots, so a stalled renderer could
still fill exactly 1,024 control frames, close the application connection, and make new
projects and terminals inert.

## Goals / Non-Goals

Goals:
- No volume or timing of PTY-derived reconstructible state can close or starve the
  application connection.
- Activity and agent state still converge to the latest authoritative snapshot.
- Unrelated workspace and terminal commands stay available under the regression workload.

Non-Goals:
- Changing terminal presentation lane semantics or the raw-output attachment path.
- Adding an event-name allowlist as the boundary.

## Decisions

- **The boundary is traffic ownership, not an event name.** All non-terminal subscription
  events are reconstructible projections and MUST use bounded subscription lanes. Only
  handshake, query, command, cancellation, and subscription-control results consume reliable
  control capacity. This is why the second pass removed the event-name fallback entirely
  instead of adding `agent` to a list.
- **Bounded keyed latest-value delivery.** Pending state for the same feature/entity key is
  superseded in place, so memory is bounded per key and unrelated keys are not reordered.
- **Congestion degrades to resynchronization.** When a projection lane overflows, the client
  receives a scoped `event_resync` and reloads the authoritative snapshot; the application
  connection is never closed for projection pressure.
- **Semantic activity publication.** Raw-output inactivity deadlines stay current without
  publishing an event per PTY callback; status, attention, acknowledgement, authority,
  progress, and exit transitions are published exactly, preserving snapshot/delta
  convergence.
- **One ordered transport writer.** Reliable control, state projection, and terminal lanes
  share a single ordered writer with fair progress, so isolating lanes does not reorder
  traffic or starve any lane.

## Risks / Trade-offs

- Coalescing full agent snapshots by subscription means a lagging client can skip
  intermediate revisions; ordered delta revisions are preserved until bounded
  resynchronization is actually required.
- Generic subscription-pressure coverage was added specifically so that future feature
  events cannot silently re-enter the fatal control queue.

## Migration Plan

_N/A — no persisted data or protocol identity changes; clients that receive `event_resync`
on a subscription reload that subscription's authoritative snapshot._
