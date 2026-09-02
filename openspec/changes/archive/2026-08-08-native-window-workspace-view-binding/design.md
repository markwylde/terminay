## Context

See proposal.md. The copy-and-close path predates server-owned workspace views
and treated the destination window as a fresh presentation rather than as a
view of canonical state. Because the copy carried a synthetic project id,
server reconciliation could not recognise the moved project, so the live
terminal presentation was lost as soon as the authoritative snapshot arrived.

## Goals / Non-Goals

Goals:
- A new native window contains exactly the moved project.
- All project, panel, and terminal session identities survive the move.
- Unrelated projects are never hydrated into the destination window.

Non-Goals:
- Giving the preload boundary generic workspace authority in order to carry the
  view binding.
- Changing panel or terminal semantics beyond the move.

## Decisions

- **One canonical workspace view per native project-host window.** The window
  renders only that view's ordered projects, so flattening every server view
  into a tab bar is no longer possible.
- **Tear-off is a move, not a close.** A destination view is created and
  `project.move` is committed. Moving is never reported or executed as project
  closure, and therefore never prompts the foreground-process close warning
  that closure would.
- **The bound view id crosses the preload boundary as a bound value**, not as a
  general workspace capability, so a renderer cannot address another view.
- **Rollback preserves usability.** A failed destination creation or move leaves
  the source project usable in its original view and cleans up any unusable
  destination window or view rather than stranding an empty one.
- **Destination activation is part of the move.** The ready destination window
  is activated so the first terminal-control click lands on the control instead
  of being consumed by macOS window activation.

## Risks / Trade-offs

- Creating the destination view before the move means a failure between the two
  steps could strand an empty view; the cleanup path exists specifically to
  cover that window.
- Activating the destination window steals focus. That is accepted because the
  alternative — a first click silently consumed by activation — reads as a
  broken control.

## Migration Plan

The renderer-local copy path is removed from the canonical tear-off flow rather
than kept as a fallback, so there is one path to verify.
