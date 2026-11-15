# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-15
- Reviewer: Claude
- Change: open-forge-items-in-tabs

## In-Force ADR Context Reviewed

- openspec/adr/0040-home-tabs-are-device-local-presentation-in-their-own-dockview.md - a Home item tab is one more device-local Home tab descriptor; the server does not know it.
- openspec/adr/0049-a-folder-groups-panels-and-is-not-an-identity-boundary.md - a folder's item tab is presentation in that folder's Dockview and carries no authority.
- openspec/adr/0106-forge-pull-requests-and-issues-come-from-pull-based-on-demand-forge-sources.md - an item tab fetches its detail on demand through the same `forge.detail` operation and narrowing as the detail pane.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

Renderer-only change; no Electron, protocol, server, or storage boundary is crossed.
