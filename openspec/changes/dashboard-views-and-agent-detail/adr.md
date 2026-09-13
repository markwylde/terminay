# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-13
- Reviewer: Mark Wylde
- Change: dashboard-views-and-agent-detail

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md — the prompt text, agent
  display names, and model identifiers the dashboard now renders are untrusted
  provider-supplied strings. They are sanitized and bounded where they cross
  the transport boundary, and the dashboard renders them as text only; it adds
  no new privileged capability and reaches no filesystem, PTY, or Git service.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md — the
  dashboard is shared workspace-bundle code and stays host-neutral. The
  remembered view mode is this origin's `localStorage`, alongside the existing
  per-device Home selection, so it never becomes host-specific behaviour.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md —
  every project, panel, and agent keeps the server that owns it. Nothing is
  merged across servers; summary counts sum over rows that each still belong
  to exactly one connection, and ids from two servers never collide because
  every key carries its server.
- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md — no new origin,
  window, or bridge. The dashboard is rendered inside the existing workspace
  view.

Superseded and therefore historical only: ADR-0007 (by ADR-0008), ADR-0008 (by
ADR-0018), ADR-0009 (by ADR-0017).

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this
  change. It composes existing renderer projections into a new presentation.

## Notes

The change deliberately introduces no server-side projection, protocol
message, or persisted server state. Everything it presents is already
subscribed to by the renderer for the tab badges and the Agents sidebar.
