# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-11
- Reviewer: Claude (Opus 5.5)
- Change: resizable-workflow-panel

## In-Force ADR Context Reviewed

- openspec/adr/0097-workflows-are-checklists-an-agent-drives-and-terminay-never-runs-a-step.md - workflow state lives on the server and the panel only presents it as pane chrome. The width is presentation and is never sent to the server.
- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - each server connection profile has its own opaque storage partition, so a device-local view setting kept in `localStorage` is shared by windows of one server and not across servers. The change scopes the width that way, as the collapse setting and workspace column widths already are.
- openspec/adr/0040-home-tabs-are-device-local-presentation-in-their-own-dockview.md - precedent for device-local presentation state; not modified.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

No ADR is superseded. The change adds no privileged surface, protocol field, or storage outside the existing renderer partition.
