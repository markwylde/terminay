# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-26
- Reviewer: Mark Wylde
- Change: fix-worktree-reveal-on-host

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - the renderer stays
  untrusted; locality is decided by the server from the transport it accepted,
  and the worktree path is resolved server-side.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md -
  reveal executes on the project's server host.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - the shared
  bundle gates the item on server data rather than host-specific checks.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

A defect fix inside existing boundaries: the adapter already declared reveal as
a host callback; this wires it for the embedded host and scopes it to that
host's own windows.
