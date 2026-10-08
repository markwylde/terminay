# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-13
- Reviewer: Mark Wylde
- Change: fix-worktree-folder-entry-delete

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md — the renderer keeps no
  filesystem authority. Directory state is decided on the server from the
  filesystem, and the symlink deletion stays inside the canonical containment
  check rather than trusting a client-supplied path.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md —
  Git status and the delete continue to execute on the project's server.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md — the folder
  presentation and the root hand-back live in the shared workspace bundle, with
  no host-specific behaviour.

Superseded and therefore historical only: ADR-0007 (by ADR-0008), ADR-0008 (by
ADR-0018), ADR-0009 (by ADR-0017).

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

A defect fix inside existing boundaries. The one security-relevant decision —
allowing a symlink to be deleted — narrows rather than widens the trust
boundary's intent: the link is addressed through its canonical parent, the
removal is non-recursive, and the target is never followed.
