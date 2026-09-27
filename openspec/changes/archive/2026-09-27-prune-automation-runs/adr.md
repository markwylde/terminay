# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-27
- Reviewer: Claude (for Mark Wylde)
- Change: prune-automation-runs

## In-Force ADR Context Reviewed

- openspec/adr/0028-no-polling-without-owner-approval.md - retention is enforced lazily on load, write, and read, with no timer
- openspec/adr/0031-mcp-authority-is-scope-times-user-permission-policy.md - no MCP surface is added, so the permission policy is unchanged
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - the remembered prune choice is per server, stored with that server's run log

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

Where the prune choice is stored (run-log file, not definition) is a tactical
choice local to the automation service and is recorded in design.md.
