# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-11
- Reviewer: Claude
- Change: bot-chat-dispatch-failure-recovery

## In-Force ADR Context Reviewed

- openspec/adr/0093-bots-communicate-through-a-durable-message-log.md - its surviving decisions say each user message starts its own execution, linked to that message. Retry keeps this: it starts a fresh execution linked to the same message and never resumes earlier work.
- openspec/adr/0099-a-bot-is-woken-by-its-own-failures-never-by-a-failures-failure.md - covers execution failures that wake a bot. A chat message that fails to start produces no execution, so it does not apply. Retry is an explicit user action, not a wake-up.
- openspec/adr/0102-an-opted-in-bot-has-pixels-full-terminay-control.md - a bot's Terminay tools act on the window that messaged it. Retry records the requesting client as the viewer, as post does.
- openspec/adr/0104-a-notification-is-acknowledged-only-by-what-the-user-does.md - consistent: Dismiss is an explicit user action, and auto-hiding only changes Chat's display, not the stored record.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

Retry and Dismiss are two more bot message commands. They follow the existing message protocol, the revision-checked mutation contract, the authority check and the event model.
