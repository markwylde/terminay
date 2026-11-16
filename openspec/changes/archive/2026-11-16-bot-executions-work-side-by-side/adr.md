# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-16
- Reviewer: Claude
- Change: bot-executions-work-side-by-side

## In-Force ADR Context Reviewed

- openspec/adr/0093-bots-communicate-through-a-durable-message-log.md - introduced overlapping executions "while shared work is leased"; its lease clause is superseded here, and the rest stays in force (also superseded in part by 0096 and 0100).
- openspec/adr/0096-bots-use-terminay-owned-native-cli-drivers.md - execution capability and native drivers; unchanged.
- openspec/adr/0100-a-bot-may-hold-workspace-mcp-reach-when-its-owner-opts-it-in.md - Terminay MCP relay pair separation in the tool shell; unchanged and still enforced.

## Repository-Level ADRs Created

- openspec/adr/0127-a-bots-executions-share-its-shell-and-desktop.md - a bot's live executions use its shell and desktop side by side; the gate checks only for a live capability; supersedes ADR-0093 in part.

## Notes

ADR-0093 is not edited.
