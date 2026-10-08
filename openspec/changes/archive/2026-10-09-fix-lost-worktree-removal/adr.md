# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-27
- Reviewer: Mark Wylde
- Change: fix-lost-worktree-removal

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - removal stays
  server-owned and identity-bound; the client still sends only opaque IDs and
  the server resolves the registration itself.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md -
  the registration is removed on the project's server host.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

A defect fix inside existing boundaries: prunable removal already existed; this
widens what counts as prunable and makes its removal work for every case Git
reports.
