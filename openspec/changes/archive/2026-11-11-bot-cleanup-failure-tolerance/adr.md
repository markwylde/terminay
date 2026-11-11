# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-11
- Reviewer: Claude
- Change: bot-cleanup-failure-tolerance

## In-Force ADR Context Reviewed

- openspec/adr/0096-bots-use-terminay-owned-native-cli-drivers.md - the host owns supervised process lifecycle and cleanup; this change keeps confirmed-group-gone as the definition of a closed agent and the condition for releasing its credential lease
- openspec/adr/0091-bots-sign-in-with-their-own-credential.md - per-bot credentials; a leaked execution's credential stays inside its own bot container
- openspec/adr/0093-bots-communicate-through-a-durable-message-log.md - executions and their runner output are durable records; the cleanup failure is appended and committed there
- openspec/adr/0094-bots-attribute-engine-workloads-through-per-bot-proxies.md - kill execs still target only the bot's own container
- openspec/adr/0099-a-bot-is-woken-by-its-own-failures-never-by-a-failures-failure.md - the blocking execution has cause `engine`, so it does not wake a failure execution; non-blocking cleanup failures don't mark the execution failed
- openspec/adr/0100-a-bot-may-hold-workspace-mcp-reach-when-its-owner-opts-it-in.md and openspec/adr/0102-an-opted-in-bot-has-pixels-full-terminay-control.md - a relay left running by a failed cleanup can't act, because the execution capability is revoked server-side before the relays close
- openspec/adr/0028-no-polling-without-owner-approval.md - the consecutive-failure count adds no timer or poll

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The deadline value and the threshold of 3 are tuning within the existing bot execution design, recorded in the change's design and the `terminay-bots` spec. Releasing shared-work ownership after a failed cleanup relies on the existing `bot-message-log` contract that sibling executions are not isolated from one another.
