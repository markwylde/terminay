# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-26
- Reviewer: Claude
- Change: remove-home-tab-strip-terminal-controls

## In-Force ADR Context Reviewed

- openspec/adr/0040-home-tabs-are-device-local-presentation-in-their-own-dockview.md - Home's tabs live in their own Dockview and never share project panel lifecycle; this change keeps project terminal-creation chrome out of that host.
- openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md - Home and project workspaces share one window document, which is why a document-wide query reached Home.
- openspec/adr/0049-a-folder-groups-panels-and-is-not-an-identity-boundary.md - project panels and their Dockview groups; unaffected.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

A presentation-scoping correction inside the renderer.
