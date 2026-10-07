# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-07
- Reviewer: Claude (with Mark Wylde)
- Change: fix-app-window-over-other-project

## In-Force ADR Context Reviewed

The supersession graph was read from the index in `openspec/adr/README.md`;
0001, 0004, 0007, 0008, 0009, 0014, 0022, 0024, 0030 and 0032 are superseded and
were treated as history only. In-force ADRs that bear on this change:

- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - the fix lives in the shared workspace bundle and must behave the same in Desktop and browser hosts.
- openspec/adr/0037-mcp-apps-reach-terminals-through-a-terminay-gateway.md - windows belong to the calling terminal session; this change makes presentation honour that.
- openspec/adr/0038-app-views-run-in-a-self-sandboxing-proxy.md - views stay mounted and are not moved; hiding must not reload them.
- openspec/adr/0039-app-views-are-mirrored-from-the-controlling-client.md - a hidden view keeps running on the controlling client.
- openspec/adr/0028-no-polling-without-owner-approval.md - visibility is re-read on the existing layout cue, never on a timer.

The remaining in-force ADRs were not constraining for a renderer presentation
fix.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

A defect fix inside the existing design: one host above the docking layout,
following registered panes. Only the test for "this pane is on screen" changes.
