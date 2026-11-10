# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-10
- Reviewer: Claude (Opus 5.5)
- Change: bot-unread-counts-on-home

## In-Force ADR Context Reviewed

- openspec/adr/0100-a-notification-belongs-to-one-terminal-or-one-bot.md - a bot notification is a server-held record behind bot authority, cleared everywhere on acknowledgement; the counts read only the published records and so inherit its authority and clearing rules.
- openspec/adr/0061-a-notification-is-a-server-owned-record-published-after-a-settle-period.md - decisions 3 to 7 continue under ADR-0100; the settle period and "consumers show only the published set" decide that an unsettled post is not counted.
- openspec/adr/0093-bots-communicate-through-a-durable-message-log.md - bot posts and their acknowledgement live on the server; the counts only present them.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The counts read the bot notification records the window already receives for the header Notifications list. No new reader of the published set is added outside the window that already lists them.
