# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-16
- Reviewer: Claude (with Mark Wylde)
- Change: untracked-terminal-tabs

## In-Force ADR Context Reviewed

- openspec/adr/0058-a-fact-taken-from-terminal-output-is-live-server-state-and-never-a-workspace-commit.md - activity stays live server state; the tracking flag is workspace state and is only read at presentation points
- openspec/adr/0059-a-workspace-change-reaches-every-layer-as-the-change.md - the notification binding reconciles on the workspace change that flips a panel's flag
- openspec/adr/0061-a-notification-is-a-server-owned-record-published-after-a-settle-period.md - untracked filtering of notifications and push belongs to the server manager, not clients
- openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md - client and server ship together, so the split renderer/server gate deploys as one
- openspec/adr/0031-mcp-authority-is-scope-times-user-permission-policy.md - MCP status tools are unaffected; tracking is not an authority or scope change

## Repository-Level ADRs Created

- openspec/adr/0065-an-untracked-terminal-is-silenced-where-activity-is-read-never-where-it-is-detected.md - per-terminal tracking is a presentation gate applied at the inventory and the notification manager; surfaces never read raw activity around it; process-sent messages are not gated

## Notes

- No in-force ADR is superseded.
