# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-06
- Reviewer: Claude
- Change: `bot-source-interruptions-do-not-wake`

## In-Force ADR Context Reviewed

- openspec/adr/0096-bot-trigger-sources-execute-in-the-owning-container.md: sources still run only in the bot container. Diagnostics come back as bounded, redacted text, with no host fallback.
- openspec/adr/0099-a-bot-is-woken-by-its-own-failures-never-by-a-failures-failure.md: classification uses structured codes, never message text. A check whose retry also fails still starts an episode and wakes the bot.
- openspec/adr/0028-no-polling-without-owner-approval.md: the retry is one deadline timer per interrupted check. No sleep, wake or health polling is added.
- openspec/adr/0093-bots-communicate-through-a-durable-message-log.md: failure executions stay server-dispatched. Unchanged.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change. The single in-check retry and the exit-status classification are tactical refinements within ADR-0096 and ADR-0099.

## Notes

Over-time-limit runs are deliberately not retried, so that slow scripts stay visible.
