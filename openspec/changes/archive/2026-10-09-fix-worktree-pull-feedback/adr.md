# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-12
- Reviewer: Mark Wylde
- Change: fix-worktree-pull-feedback

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - the renderer stays
  untrusted at the Git boundary; the pull ref is resolved on the server from
  Git, never supplied by the client.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md -
  the Git pull continues to execute on the project's server.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - the
  pulling presentation lives in the shared workspace bundle, with no
  host-specific behaviour.

Superseded and therefore historical only: ADR-0007 (by ADR-0008), ADR-0008 (by
ADR-0018), ADR-0009 (by ADR-0017).

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The change is a defect fix inside existing boundaries: pull ref resolution stays
server-side, failure reporting reuses the established assert-and-report path,
and progress reuses the existing in-flight worktree presentation.
