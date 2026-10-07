# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-19
- Reviewer: Mark Wylde
- Change: dashboard-board-group-by-project

## In-Force ADR Context Reviewed

- openspec/adr/0018-one-workspace-bundle-many-server-connections.md — the
  grouped Board is shared workspace-bundle code and stays host-neutral. The
  remembered grouping is this origin's `localStorage`, beside the remembered
  view mode, so it never becomes host-specific behaviour.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md —
  a lane is keyed by its server-scoped group, so two servers with equal project
  ids stay two lanes and nothing merges across servers.
- openspec/adr/0011-security-trust-boundary-model.md — no new privileged call,
  protocol message, or Electron IPC. The lanes render strings the Board already
  renders, as text only.
- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md — unchanged; no new
  origin, window, or bridge.

Superseded and therefore historical only: ADR-0007 (by ADR-0008), ADR-0008 (by
ADR-0018), ADR-0009 (by ADR-0017).

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this
  change. It is a second arrangement of cards the Board already builds.

## Notes

The highest ADR sequence number in use is 0027.
