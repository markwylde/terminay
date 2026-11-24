# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-16
- Reviewer: Claude (Opus 5.5)
- Change: bot-files-row-menu

## In-Force ADR Context Reviewed

- openspec/adr/0089-bots-run-agents-in-their-own-container-over-acp.md - bots and their per-bot Files helper live on the server; in force except the ACP parts ADR-0096 supersedes. This change only re-presents the existing Files actions.
- openspec/adr/0092-bots-use-the-local-docker-compatible-socket.md - the Files helper's engine access is unchanged; in force except the ACP reaffirmation ADR-0096 supersedes.
- openspec/adr/0096-bots-use-terminay-owned-native-cli-drivers.md - partly supersedes 0089 and 0092 (ACP only); nothing here touches agent drivers.
- openspec/adr/0126-status-colours-have-one-source.md - the menu's danger item keeps the shared context-menu styling; no new status colour is introduced.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

Presentation-only change in the shared workspace UI; no privileged, protocol, or helper boundary is touched.
