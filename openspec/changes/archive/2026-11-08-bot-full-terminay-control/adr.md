# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-08
- Reviewer: Claude (Opus 5.5)
- Change: bot-full-terminay-control

## In-Force ADR Context Reviewed

- openspec/adr/0100-a-bot-may-hold-workspace-mcp-reach-when-its-owner-opts-it-in.md - opted-in bots hold workspace reach; its spec gave them no agent's client, which this change reverses.
- openspec/adr/0066-choosing-a-project-root-browses-server-directory-names-under-root-change-authority.md - kept root-choosing queries away from MCP; this change lets workspace reach read recent folders only.
- openspec/adr/0070 and the mcp-workspace-view spec - how an agent's client is found for terminals and chats; the bot rule follows the chat rule.

## Repository-Level ADRs Created

- openspec/adr/0102-an-opted-in-bot-has-pixels-full-terminay-control.md - a bot's agent's client is the window that last messaged it, else the latest window; workspace reach can list recent project folders.

## Notes

- show_window stays unavailable to bots, as it is to chats: an app window belongs to a calling terminal.
