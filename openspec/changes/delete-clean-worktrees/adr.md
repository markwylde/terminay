# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-20
- Reviewer: Mark Wylde
- Change: delete-clean-worktrees

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md — the renderer nominates
  worktrees by opaque ID only; cleanliness is recomputed on the server
  immediately before removal and the client's judgement is never trusted.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md —
  clean-only removal executes in the owning server's Git service, like forced
  removal.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md — the bundle
  may be newer than the server. This is why clean-only removal is a distinct
  operation that an older server rejects, rather than a flag it would ignore.
- openspec/adr/0022-watch-do-not-poll.md — the batch adds no polling; it issues
  one refresh when it settles.

Reviewed and not relevant to this change: ADR-0001 through ADR-0006, ADR-0010,
ADR-0012, ADR-0013, ADR-0015, ADR-0016, ADR-0019 through ADR-0021, ADR-0023,
ADR-0025 through ADR-0027.

Superseded and therefore historical only: ADR-0007 (by ADR-0008), ADR-0008 (by
ADR-0018), ADR-0009 (by ADR-0017), ADR-0014 and ADR-0024 (by ADR-0025).

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

"Add an operation rather than a flag when an ignored flag would be unsafe" is a
direct consequence of ADR-0018's per-connection compatibility, applied once
here. It is recorded in design.md; it does not yet warrant its own ADR.
