# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-06
- Reviewer: Claude (with Mark Wylde's investigation request)
- Change: bot-failure-awareness

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - failure prompts and runner output are untrusted data inside the bot's own scope
- openspec/adr/0028-no-polling-without-owner-approval.md - follow-ups are event-driven; the hourly cap uses a single deadline timer, not a poll
- openspec/adr/0088-terminay-state-files-are-replaced-durably-and-recovered-by-kind.md - follow-up state is a durable state file
- openspec/adr/0092-bots-use-the-local-docker-compatible-socket.md - process counts come from the engine stats API over the existing transport
- openspec/adr/0093-bots-communicate-through-a-durable-message-log.md - failure executions are fresh server-dispatched executions; runtime reads stay bot-scoped; no post-triggered executions
- openspec/adr/0094-bots-attribute-engine-workloads-through-per-bot-proxies.md - no change to engine exposure
- openspec/adr/0096-bot-trigger-sources-execute-in-the-owning-container.md - source failures feed trigger health, which drives follow-ups
- openspec/adr/0096-bots-use-terminay-owned-native-cli-drivers.md - native driver failure classification is extended, not replaced
- openspec/adr/0098-bot-desktop-owns-graphical-applications.md - the desktop session now publishes its bus address for supervised commands

## Repository-Level ADRs Created

- openspec/adr/0099-a-bot-is-woken-by-its-own-failures-never-by-a-failures-failure.md - server-dispatched, coalesced, capped failure executions that never chain

## Notes

Sharing the desktop D-Bus session with supervised commands (D1) is a tactical container fix within ADR-0093's shared-container domain and does not need its own ADR.
