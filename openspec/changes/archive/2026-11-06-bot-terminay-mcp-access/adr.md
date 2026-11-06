# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-06
- Reviewer: Claude (Opus 5.5)
- Change: bot-terminay-mcp-access

## In-Force ADR Context Reviewed

- openspec/adr/0068-mcp-authority-belongs-to-a-terminal-or-a-chat.md: terminal and chat caller kinds, and approval surfaces per kind. It says a new caller kind needs a new ADR.
- openspec/adr/0072-mcp-reach-is-the-authority-line-and-workspace-reach-controls-the-app.md: workspace reach grants app-level control, and the excluded set still applies to bots.
- openspec/adr/0098-project-reach-may-curate-workflow-templates-behind-an-asking-group.md: project reach only, so it is unaffected.
- openspec/adr/0093-bots-communicate-through-a-durable-message-log.md: the scoped runtime MCP and the authenticated exec relay. Its rule that keeps Terminay MCP away from bots is superseded.
- openspec/adr/0099-a-bot-is-woken-by-its-own-failures-never-by-a-failures-failure.md: unaffected.

## Repository-Level ADRs Created

- openspec/adr/0100-a-bot-may-hold-workspace-mcp-reach-when-its-owner-opts-it-in.md: a bot execution becomes a third MCP caller kind with workspace reach, behind a per-bot opt-in that is its standing approval. Never Allow still binds it, and the token never enters the container.

## Notes

- Delivery reuses the existing bot exec relay and adapter, so the bot image doesn't change.
