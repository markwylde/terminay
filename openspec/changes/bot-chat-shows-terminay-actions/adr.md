# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-17
- Reviewer: Claude (Opus 5.5)
- Change: bot-chat-shows-terminay-actions

## In-Force ADR Context Reviewed

- openspec/adr/0093-bots-communicate-through-a-durable-message-log.md - in force for the durable message log and "provider output stays diagnostic". This change keeps provider tool use in execution details and adds server-observed action entries to the log, recorded in ADR-0134.
- openspec/adr/0100-a-bot-may-hold-workspace-mcp-reach-when-its-owner-opts-it-in.md - in force for the bot execution capability and relay. Recording happens after dispatch on that capability; reach and permission are unchanged.
- openspec/adr/0068-mcp-authority-belongs-to-a-terminal-or-a-chat.md, openspec/adr/0072-mcp-reach-is-the-authority-line-and-workspace-reach-controls-the-app.md - the recorder resolves targets with the same reach-checked resolvers and opaque project handles; no handle or ID is exposed to the agent.
- openspec/adr/0126-status-colours-have-one-source.md - done and failed marks use the shared status colours.

## Repository-Level ADRs Created

- openspec/adr/0134-a-bots-terminay-actions-are-recorded-by-the-server-in-its-message-log.md - server-recorded, server-worded action entries in the bot message log, with server-resolved link targets.

## Notes

ADR 0133 is taken on another branch, so this change uses 0134.
