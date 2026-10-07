# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-05
- Reviewer: Mark Wylde
- Change: home-dockview-tabs

## In-Force ADR Context Reviewed

- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - Home
  spans every attached connection, so Home tabs carry a server id and close
  when that connection is no longer attached. Supersedes ADR-0008.
- openspec/adr/0011-security-trust-boundary-model.md - Home tabs add no
  authority; every action still goes through the existing client operations.
- openspec/adr/0028-no-polling-without-owner-approval.md - stale-tab cleanup and
  layout saving are event-driven, with no timer. Supersedes ADR-0022.
- openspec/adr/0031-mcp-authority-is-scope-times-user-permission-policy.md -
  automations and their terminals stay server-owned and MCP authority is
  unchanged; a Home tab only shows them. Supersedes ADR-0030.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md -
  unaffected; no execution moves.

## Repository-Level ADRs Created

- openspec/adr/0040-home-tabs-are-device-local-presentation-in-their-own-dockview.md -
  Home has its own tab host, separate from server-owned project panels, and its
  arrangement is device-local state that may be stored as a Dockview document.

## Notes

No in-force ADR is superseded. ADR-0040 leaves the rule against Dockview
documents for server-owned workspace layout in place and scopes the exception
to Home.
