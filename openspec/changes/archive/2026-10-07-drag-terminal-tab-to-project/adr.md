# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-03
- Reviewer: Claude
- Change: drag-terminal-tab-to-project

## In-Force ADR Context Reviewed

- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - project ids are per-server namespaces, so drop targets are matched by composed `(serverId, projectId)` handle and never by project id alone.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md - a panel never crosses servers; drop eligibility reuses `panelMoveTargets`, the existing home of that rule.
- openspec/adr/0011-security-trust-boundary-model.md - the project boundary is crossed only by the existing export/adopt move path; the renderer gains no new authority and no new channel.

The remaining in-force ADRs (runtime, storage, vault, PTY, transport, CI, extensions, agents, updates, polling, automations, MCP authority) were checked against the supersession graph and do not bear on a renderer-only drag gesture.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

Listening for HTML5 drops outside Dockview's surface, keyed off the app's existing Dockview drag bookkeeping, is a tactical renderer choice for one gesture. If further cross-surface drops are added (files onto projects, panels onto the switcher), a shared drag-source registry may then be worth recording.
