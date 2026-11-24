# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-16
- Reviewer: Claude (Opus 5.5)
- Change: quote-bot-messages

## In-Force ADR Context Reviewed

- openspec/adr/0093-bots-communicate-through-a-durable-message-log.md - in force for the durable message log, fresh executions and coordination tools; partly superseded by ADR-0096 (ACP reaffirmation), ADR-0100 (workspace MCP for opted-in bots) and ADR-0127 (shared-work lease), none of which touch message content. A quote is plain text in a new post, so the log model is unchanged.
- openspec/adr/0096-bots-use-terminay-owned-native-cli-drivers.md, openspec/adr/0100-a-bot-may-hold-workspace-mcp-reach-when-its-owner-opts-it-in.md, openspec/adr/0127-a-bots-executions-share-its-shell-and-desktop.md - reviewed as ADR-0093's partial superseders; nothing here changes drivers, MCP reach or execution sharing.
- openspec/adr/0126-status-colours-have-one-source.md - the new menu item uses the shared context-menu styling; no new colour.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

Presentation-only change in the shared workspace UI; no privileged, protocol, or server boundary is touched.
