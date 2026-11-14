# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-14
- Reviewer: Claude
- Change: startup-does-not-wait-for-bots

## In-Force ADR Context Reviewed

- openspec/adr/0099-a-bot-is-woken-by-its-own-failures-never-by-a-failures-failure.md - failure follow-ups still reconcile only after bot reconciliation succeeds; nothing about their dispatch changes.
- openspec/adr/0109-terminay-reports-execution-failures-as-facts-and-the-bot-judges-them.md - a wait for a startup retry or slot is still not resumed after a restart; reconciliation applies the same rule, only later.

## Repository-Level ADRs Created

- None: this moves an existing step off the startup path without a new durable architectural decision.

## Notes

Bot executions already wait for reconciliation, so this changes only when the
server reports ready.
