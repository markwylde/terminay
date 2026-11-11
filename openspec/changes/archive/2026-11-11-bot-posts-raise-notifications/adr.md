# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-06
- Reviewer: Claude
- Change: `bot-posts-raise-notifications`

## In-Force ADR Context Reviewed

- openspec/adr/0061-a-notification-is-a-server-owned-record-published-after-a-settle-period.md - Each notification belongs to one terminal and is never persisted. This is superseded in part by ADR-0100. The settle period and the rule that consumers show only the published set continue.
- openspec/adr/0060-a-push-is-sealed-per-pairing-and-attributed-by-the-device.md - Push banners are unchanged. Bot records are kept out of push.
- openspec/adr/0072-mcp-reach-is-the-authority-line-and-workspace-reach-controls-the-app.md - MCP reach covers terminals and projects. The notification tools keep to terminal records.
- openspec/adr/0093-bots-communicate-through-a-durable-message-log.md - The durable message log, with its monotonic sequence, is where acknowledgement is persisted.
- openspec/adr/0028-no-polling-without-owner-approval.md - The feed is event-driven from message store changes. No poll is added.
- openspec/adr/0011-security-trust-boundary-model.md - The renderer only asks the server to acknowledge. The server enforces bot authority on every read and dismissal.

## Repository-Level ADRs Created

- openspec/adr/0100-a-notification-belongs-to-one-terminal-or-one-bot.md - A notification belongs to a terminal or a bot. The bot service is a bot's only source. Bot notifications stay behind bot authority. Sources persist their own facts. This supersedes ADR-0061 decisions 1, 2 and 8.

## Notes

The README index gains a row for ADR-0100.
