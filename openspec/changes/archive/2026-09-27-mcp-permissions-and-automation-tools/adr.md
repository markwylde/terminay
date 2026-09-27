# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-27
- Reviewer: Claude (with Mark Wylde)
- Change: mcp-permissions-and-automation-tools

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - the control-socket row: authority never inferred from renderer, focus or caller input; the new policy gate honours it.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md - policy and approvals are per server; no cross-server approvals.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - one renderer bundle serves desktop, web and mobile, so one inline prompt component covers every client.
- openspec/adr/0028-no-polling-without-owner-approval.md - approvals are pushed through the event journal, never polled.
- openspec/adr/0030-automations-run-in-a-server-owned-space-with-workspace-scoped-mcp.md - decision 3 (MCP never manages automations) is revisited; superseded by 0031, other decisions carried forward.

## Repository-Level ADRs Created

- openspec/adr/0031-mcp-authority-is-scope-times-user-permission-policy.md - MCP authority is capability scope plus a server-owned per-group permission policy with inline, request-bound approvals; MCP may manage automations behind it (supersedes ADR-0030).

## Notes

- The ADR index in openspec/adr/README.md gains the 0031 row and marks 0030 superseded; the 0030 file itself is untouched.
