# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-03
- Reviewer: Claude (for Mark Wylde to confirm at merge)
- Change: fix-sweep-locked-clean-worktrees

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - the server still decides
  cleanliness and derives every path from its own listing; the client only
  nominates opaque IDs.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md -
  the unlock and removal run on the project's server host.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md -
  an older server refuses a locked target as before, and the sweep reports it.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

A defect fix inside existing boundaries: clean-only removal stops treating a
lock as proof the worktree is wanted.
