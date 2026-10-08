# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-12
- Reviewer: Mark Wylde
- Change: touch-text-selection-and-link-taps

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md — terminal content stays
  untrusted text. Touch link activation changes only which gesture activates a
  link, not which URLs are allowed: the existing credential-free HTTP/HTTPS
  parse is unchanged, and opening still goes through the narrow host bridge.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md — both
  gestures live in the shared workspace bundle and are host-neutral. The
  per-device preference is this origin's `localStorage`, like the existing
  per-device view state, so it never becomes host-specific behaviour.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md —
  nothing here reaches a server. Selection, link activation, and the clipboard
  are renderer-local.

Superseded and therefore historical only: ADR-0007 (by ADR-0008), ADR-0008 (by
ADR-0018), ADR-0009 (by ADR-0017).

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The change adds two gestures inside an existing boundary and fixes two
browser-only user-activation faults. The one notable trade-off — reaching
`_core._selectionService` to lend the selection back inside a mouse tracking
program — follows the precedent already set by
`terminalMouseReportCoords.ts` and is guarded so a missing internal is a no-op
rather than a failure.
