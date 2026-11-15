# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-15
- Reviewer: Claude
- Change: resizable-forge-detail-pane

## In-Force ADR Context Reviewed

The full `openspec/adr/` index (ADR-0001 to ADR-0124) was scanned for decisions
on Home presentation, device-local state, and forge views. None of the in-force
ADRs below is superseded; none decides the width of a Home preview.

- [ADR-0040](../../adr/0040-home-tabs-are-device-local-presentation-in-their-own-dockview.md):
  Home presentation is device-local. The preview width follows it.
- [ADR-0101](../../adr/0101-the-home-overview-layout-is-a-server-setting.md):
  only the Home overview's widget layout is a server setting. It does not
  cover the Pull Requests and Issues sections, so this width stays per device.
- [ADR-0106](../../adr/0106-forge-pull-requests-and-issues-come-from-pull-based-on-demand-forge-sources.md):
  defines the Home list/detail shell this change resizes; its structure and
  data flow are unchanged.
- The device-local column widths named in `server-owned-workspace-state`, and
  the workflow panel's device-local width in `terminal-workflows`, set the
  precedent followed here.

## Repository-Level ADRs Created

- None: a resizable preview with a device-remembered width is a tactical UI
  decision that follows ADR-0040 and existing specs, not a new durable
  architectural commitment.
