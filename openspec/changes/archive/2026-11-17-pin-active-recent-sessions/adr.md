# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-17
- Reviewer: Claude (agent)
- Change: pin-active-recent-sessions

## In-Force ADR Context Reviewed

- openspec/adr/0093-bots-communicate-through-a-durable-message-log.md - sessions are executions recorded against a bot's log; this change only reorders their presentation.
- openspec/adr/0127-a-bots-executions-share-its-shell-and-desktop.md - concurrent executions and bounded admission mean several sessions can be active at once, which sets the rail's overflow rule.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

Renderer-only ordering and styling change; no protocol, server, or privilege boundary moves.
