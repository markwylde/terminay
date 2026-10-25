# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-25
- Reviewer: Mark Wylde
- Change: mcp-token-follows-moved-terminal

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - the token stays opaque,
  revocable, and bound to an immutable session. The project is derived from the
  server-owned session's canonical placement, never from caller input.
- openspec/adr/0031-mcp-authority-is-scope-times-user-permission-policy.md -
  reach is still minted only from canonical placement (carried from ADR-0030).
- openspec/adr/0072-mcp-reach-is-the-authority-line-and-workspace-reach-controls-the-app.md -
  only workspace reach can move terminals across projects, so a project-scope
  agent cannot use a move to change its own scope.

## Repository-Level ADRs Created

- openspec/adr/0074-a-terminals-mcp-capability-follows-it-between-projects-and-never-widens.md -
  a capability is re-scoped in place on a project move, ends per-scope state, and
  is revoked rather than widened on entering the automation space.

## Notes

No in-force ADR is superseded.
