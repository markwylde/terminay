# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-16
- Reviewer: Claude (for Mark Wylde)
- Change: macro-queue-shows-current-step

## In-Force ADR Context Reviewed

- openspec/adr/0028-no-polling-without-owner-approval.md - progress is pushed per step from the runner; no client or server timer samples run state.
- openspec/adr/0030-automations-run-in-a-server-owned-space-with-workspace-scoped-mcp.md - automation runs share the macro runner; the optional step callback leaves them unchanged.
- openspec/adr/0011-security-trust-boundary-model.md - step snapshots carry the same target and fields as existing run snapshots; no new data crosses to clients.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

Publishing more of an existing event is a tactical fix inside the server-owned macro execution model already specified.
