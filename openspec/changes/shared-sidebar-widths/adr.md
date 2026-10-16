# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-16
- Reviewer: Claude (for Mark Wylde)
- Change: shared-sidebar-widths

## In-Force ADR Context Reviewed

- openspec/adr/0040-home-tabs-are-device-local-presentation-in-their-own-dockview.md - Home presentation is device-local and stays off the server; this change applies the same rule to the Home sidebar width.
- openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md - client and server in a window share one bundle, so `fileExplorerWidth` can leave the sidebar DTO without mixed-version tolerance.
- openspec/adr/0053-in-page-windows-share-one-modal-frame.md - geometry is kept on the device; column widths follow that precedent.
- openspec/adr/0059-a-workspace-change-reaches-every-layer-as-the-change.md - removing width commits removes one source of sidebar workspace changes; nothing new is added to the change path.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

Keeping layout geometry on the device is already established by ADR-0040 and ADR-0053. This change brings column widths in line with it rather than setting a new rule.
