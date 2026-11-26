# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-24
- Reviewer: Claude
- Change: `add-bot-trigger-gate`

## In-Force ADR Context Reviewed

- openspec/adr/0096-bot-trigger-sources-execute-in-the-owning-container.md - status proposed, and the contract the trigger code follows. The gate runs in the owning bot's container as the bot user, through the same worker and exec transport as command sources. No host execution.
- openspec/adr/0109-terminay-reports-execution-failures-as-facts-and-the-bot-judges-them.md - a broken gate is reported to the bot as a fact in the run it starts; Terminay does not judge it, block the trigger or open an investigation.
- openspec/adr/0099-a-bot-is-woken-by-its-own-failures-never-by-a-failures-failure.md - a gated firing is not a failure and starts no failure follow-up.
- openspec/adr/0138-a-permitted-bot-reads-other-bots-through-allowlisted-runtime-tools.md - the gate is not added to the other-bot inspection allowlist, like trigger commands.
- openspec/adr/0028-no-polling-without-owner-approval.md - the gate runs once per firing and adds no poll or timer.
- openspec/adr/0093-bots-communicate-through-a-durable-message-log.md and openspec/adr/0134-a-bots-terminay-actions-are-recorded-by-the-server-in-its-message-log.md - trigger tools stay bot-scoped and recorded; unchanged.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change. The gate is one more script run under ADR-0096's execution boundary, and its fail-open rule applies ADR-0109 to a new fact.

## Notes

The gate's stdout-is-the-verdict contract is product behaviour and lives in the `bot-triggers` spec.
