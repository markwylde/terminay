# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-04
- Reviewer: Codex
- Change: adopt-atlas-bot-runtime

## In-Force ADR Context Reviewed

- openspec/adr/0028-no-polling-without-owner-approval.md — event-driven desktop supervision and build progress.
- openspec/adr/0051-terminay-observes-agents-and-does-not-instrument-them.md — agent-launch exception scope.
- openspec/adr/0067-chat-providers-may-run-agents-as-an-owner-approved-exception.md — project chats remain independently governed.
- openspec/adr/0088-terminay-state-files-are-replaced-durably-and-recovered-by-kind.md — durable build summary persistence/recovery.
- openspec/adr/0091-bots-sign-in-with-their-own-credential.md — current per-bot credential boundary.
- openspec/adr/0092-bots-use-the-local-docker-compatible-socket.md — current engine transport and retained bot-container/local-build commitments.
- openspec/adr/0093-bots-communicate-through-a-durable-message-log.md — fresh executions, scoped tools, communication and coordination; explicitly retains ACP before this change.
- openspec/adr/0094-bots-attribute-engine-workloads-through-per-bot-proxies.md — current engine attribution and unrestricted shared-engine access.
- openspec/adr/0095-claude-bots-sign-in-through-their-own-cli.md — current native guided login and retained per-bot ownership.

## Repository-Level ADRs Created

- openspec/adr/0096-bots-use-terminay-owned-native-cli-drivers.md — native-driver adoption through a self-contained source port; narrow supersession of ACP and adapter-bound installation choices.

## Notes

The ADR file inventory, decision sections and Supersedes links were reviewed before drafting. ADR-0089 is historical context whose surviving commitments are explicitly reaffirmed by later bot ADRs. ADR-0090's host-login choice is superseded and is not revived. Two historical files use sequence 0095; this proposal uses the next unused sequence 0096. No accepted prior file is edited. The build timeline is a presentation/projection change under existing server-state and no-polling commitments, not a separate durable architecture decision.
