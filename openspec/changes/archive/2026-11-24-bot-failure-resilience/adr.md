# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-11
- Reviewer: Claude (openspec-propose)
- Change: bot-failure-resilience

## In-Force ADR Context Reviewed

- openspec/adr/0028-no-polling-without-owner-approval.md - retry waits and next-firing bounds use single deadline timers, never polling
- openspec/adr/0093-bots-communicate-through-a-durable-message-log.md - retries stay inside one execution; `outcome_report` is a scoped runtime tool bound to the execution capability (as amended by ADR-0096 and ADR-0100)
- openspec/adr/0099-a-bot-is-woken-by-its-own-failures-never-by-a-failures-failure.md - partly superseded: temporary startup failures and repeated failures of one trigger no longer each wake the bot
- openspec/adr/0104-a-notification-is-acknowledged-only-by-what-the-user-does.md - a `needs-human` post raises the normal bot notification, which is acknowledged unchanged
- openspec/adr/0107-a-device-sign-in-is-checked-before-each-session.md - the sign-in check stays a pre-start gate and is not retried as a temporary failure
- openspec/adr/0092-bots-use-the-local-docker-compatible-socket.md - deadlines split into exec start and command run on the same socket transport

## Repository-Level ADRs Created

- openspec/adr/0109-terminay-reports-execution-failures-as-facts-and-the-bot-judges-them.md - retry only before a recorded task hand-over, structured temporary startup failures separate from blocking causes, a machine-wide startup budget, `outcome_report` with needs-human trigger blockers, and trigger failure episodes; supersedes ADR-0099 in part

## Notes

- The ADR index in openspec/adr/README.md gains a row for 0109.
