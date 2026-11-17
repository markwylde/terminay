# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-17
- Reviewer: Claude (Opus 5.5)
- Change: bot-chat-threads

## In-Force ADR Context Reviewed

- openspec/adr/0093-bots-communicate-through-a-durable-message-log.md - in force for the durable log, fresh executions per message and bounded runtime tools; threads are added inside that log without changing its model.
- openspec/adr/0100-a-notification-belongs-to-one-terminal-or-one-bot.md - a thread reply by the bot counts towards the bot's single notification.
- openspec/adr/0104-a-notification-is-acknowledged-only-by-what-the-user-does.md - in force; threads add no acknowledgement cause, and a reply counts as observed only once its root's summary or the open panel shows it. The pending `bot-notifications-clear-only-on-interaction` change aligns the canonical requirements with this ADR.
- openspec/adr/0127-a-bots-executions-share-its-shell-and-desktop.md - unchanged; a thread-reply execution is an ordinary execution.
- openspec/adr/0130-desktop-saves-renderer-bytes-through-a-streamed-host-save.md - thread attachments reuse the same file chips and save path.

## Repository-Level ADRs Created

- openspec/adr/0135-bot-message-threads-live-in-the-message-log.md - one-level threads stored as replies in the bot's message log, with derived summaries, thread-scoped reads and explicit threading for bot posts.

## Notes

No privilege, project/window or terminal-session boundary changes: client reads/posts stay behind bot authority and runtime tools behind the execution capability.
