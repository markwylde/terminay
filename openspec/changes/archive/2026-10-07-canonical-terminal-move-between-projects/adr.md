# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-07
- Reviewer: Claude
- Change: canonical-terminal-move-between-projects

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - project and terminal-session boundaries are security boundaries and credentials resolve to immutable server/project/session state; the re-home is designed to keep that invariant by ending identities rather than editing them.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md - a panel never crosses servers; the move stays within one server and `panel.move` policy is unchanged.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - project ids are per-server namespaces and server and UI ship together, so no mixed-version pairing needs handling.
- openspec/adr/0035-detached-session-holder-owns-ptys.md - the holder owns the PTY and the server rebuilds identity from workspace state on reattach, which is why a moved terminal returns under its target project after restart.
- openspec/adr/0031-mcp-authority-is-scope-times-user-permission-policy.md - an MCP capability's scope is fixed at issue; the move revokes it rather than re-scoping it.
- openspec/adr/0028-no-polling-without-owner-approval.md - convergence on other clients comes from the published workspace revision, not from polling.
- openspec/adr/0040-home-tabs-are-device-local-presentation-in-their-own-dockview.md - project panels are canonical server objects; the renderer-only move this change removes was the one place a project panel changed owner without the server.

The supersession graph was walked: ADR-0001, 0004, 0007, 0008, 0009, 0010, 0014, 0022, 0024, 0030, and 0032 are superseded and were treated as history only. The remaining in-force ADRs (runtime baseline, storage, vault, client hosts, WebRTC, PWA, pairing, signaling, distribution, language intelligence, canonical roots, spawn cost, clipboard scratch, agent detection, native modules, updates, worktree facts, CI budget, MCP Apps and app views) do not bear on moving a terminal between projects.

## Repository-Level ADRs Created

- openspec/adr/0043-a-terminal-changes-project-by-retiring-its-identity.md - a committed `panel.move` retires a terminal's identity under the source project and binds a new one for the same PTY; nothing bound to the old identity is carried over, and only the server performs the re-home.

## Notes

ADR-0043 does not supersede ADR-0011. It records how a terminal changes project in a way that keeps ADR-0011's invariant, and states that reading explicitly. The ADR index in `openspec/adr/README.md` gained rows for 0040, which was missing, and 0041.
