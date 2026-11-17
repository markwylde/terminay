# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-17
- Reviewer: Claude (for Mark Wylde)
- Change: resizable-bots-rail

## In-Force ADR Context Reviewed

- openspec/adr/0040-home-tabs-are-device-local-presentation-in-their-own-dockview.md - Home presentation is device-local and stays off the server; the Bots rail width is Home presentation and follows the same rule.
- openspec/adr/0053-in-page-windows-share-one-modal-frame.md - geometry is kept on the device; the rail width follows that precedent.
- openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md - the change is renderer-only within the host bundle; no protocol or server surface changes.

## Repository-Level ADRs Created

- None: reusing the existing device-local column-width store and pane separator introduces no new durable architectural decision.

## Notes

The rail width joins the existing `terminay.view.column-widths.v1` store
introduced by `shared-sidebar-widths`; nothing travels to a server.
