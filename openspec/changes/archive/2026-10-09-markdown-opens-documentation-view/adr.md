# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-24
- Reviewer: Claude (with Mark Wylde)
- Change: markdown-opens-documentation-view

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - renderer stays untrusted; presentation is opaque UI state and grants no authority.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md - file sessions and path validation stay server-side; unchanged.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - the change lives entirely in the shared workspace bundle; desktop and web behave identically.
- openspec/adr/0020-per-operation-canonical-roots.md - canonical path identity used for the one-panel-per-file rule; unchanged.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The default-presentation rule is a product behaviour recorded in the `file-viewer` and `documentation-sidebar-and-editor` specs, not an architectural commitment.
