# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-06
- Reviewer: Claude (Opus 5.5)
- Change: bot-terminay-mcp-own-relay-env

## In-Force ADR Context Reviewed

- openspec/adr/0100-a-bot-may-hold-workspace-mcp-reach-when-its-owner-opts-it-in.md: decision 3 already requires a separate authenticated relay and keeps the token out of the container. This change makes delivery meet it for the native drivers.
- openspec/adr/0093-bots-communicate-through-a-durable-message-log.md: the container boundary and the exec relay are unchanged.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

- This is a delivery fix within ADR-0100 decision 3. Per-server variable names and the adapter's selection flag are implementation details of that decision.
