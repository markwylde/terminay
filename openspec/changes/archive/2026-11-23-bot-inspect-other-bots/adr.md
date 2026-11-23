# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-23
- Reviewer: Claude
- Change: bot-inspect-other-bots

## In-Force ADR Context Reviewed

- openspec/adr/0100-a-bot-may-hold-workspace-mcp-reach-when-its-owner-opts-it-in.md - a bot's Terminay MCP access is a profile setting, revoked at once; the new setting follows the same user-only pattern.
- openspec/adr/0093-bots-communicate-through-a-durable-message-log.md - the scoped runtime tools this read path extends.
- openspec/adr/0134-a-bots-terminay-actions-are-recorded-by-the-server-in-its-message-log.md - action entries and link targets; inspection records nothing and withholds link targets.
- openspec/adr/0135-bot-message-threads-live-in-the-message-log.md - thread reads reuse the message log.

## Repository-Level ADRs Created

- openspec/adr/0138-a-permitted-bot-reads-other-bots-through-allowlisted-runtime-tools.md - the opt-in, read-only, allowlisted path between bots.

## Notes

ADR-0138 supersedes ADR-0100 decision 4 and ADR-0093's runtime scoping in part, only for this read path. Terminay MCP capabilities still cannot read a bot, and no capability can create, change or prompt one.
