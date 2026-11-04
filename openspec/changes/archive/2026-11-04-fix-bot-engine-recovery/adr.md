# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-03
- Reviewer: Codex
- Change: fix-bot-engine-recovery

## In-Force ADR Context Reviewed

- openspec/adr/0028-no-polling-without-owner-approval.md - user-demanded metrics and lifecycle-owned events.
- openspec/adr/0059-a-workspace-change-reaches-every-layer-as-the-change.md - work proportional to affected state.
- openspec/adr/0088-terminay-state-files-are-replaced-durably-and-recovered-by-kind.md - durable pending deletion intent storage.
- openspec/adr/0091-bots-sign-in-with-their-own-credential.md - credentials remain bot-owned and redacted.
- openspec/adr/0092-bots-use-the-local-docker-compatible-socket.md - explicit identity adoption and local socket transport, subject to ADR-0094's partial supersession.
- openspec/adr/0093-bots-communicate-through-a-durable-message-log.md - execution-bound capabilities and diagnostics separate from communication.
- openspec/adr/0094-bots-attribute-engine-workloads-through-per-bot-proxies.md - workload labels do not imply main-container identity.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The pending deletion record implements existing durability and ownership rules for this lifecycle operation. It establishes no new storage technology or authority boundary. Accepted ADRs remain unchanged. ADR-0090 is superseded; ADR-0089's affected provisions are superseded by ADR-0092/0093/0094. Highest existing sequence is 0094. The MCP failure cause remains unconfirmed and must be established by reproduction and diagnostics.
