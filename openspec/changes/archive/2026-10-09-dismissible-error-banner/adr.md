# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-03
- Reviewer: Mark Wylde
- Change: dismissible-error-banner

## In-Force ADR Context Reviewed

- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - the
  banner and its dismiss control live in the shared workspace bundle, with no
  host-specific behaviour.
- openspec/adr/0011-security-trust-boundary-model.md - dismissal is renderer
  presentation state only; it crosses no privileged boundary.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The change adds a control to an existing presentation surface and clears
renderer-local state.
