# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-26
- Reviewer: Codex
- Change: preserve-claude-background-approvals

## In-Force ADR Context Reviewed

- openspec/adr/0140-bot-sessions-have-no-time-limit-and-are-watched-by-check-ins.md - lifecycle through background work without a time limit.
- openspec/adr/0028-no-polling-without-owner-approval.md - use native events for shutdown decisions.
- openspec/adr/0096-bots-use-terminay-owned-native-cli-drivers.md - verify host approvals against the pinned CLI.
- openspec/adr/0109-terminay-reports-execution-failures-as-facts-and-the-bot-judges-them.md - the bot judges the task outcome. The runner can identify its own protocol failures.

## Repository-Level ADRs Created

- None. The adapter applies the existing execution-lifecycle and authority decisions to Claude's background events.
