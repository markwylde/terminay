# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-03
- Reviewer: Claude (for Mark Wylde to confirm at merge)
- Change: fix-removed-worktree-refresh

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - the listing stays
  server-owned and project-bound; the named worktree is an opaque ID compared
  against the server's own listing and never becomes a path.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md -
  the listing runs on the project's server host, as before.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

A defect fix inside existing boundaries: the listing stops resolving a worktree
it never acts inside.
