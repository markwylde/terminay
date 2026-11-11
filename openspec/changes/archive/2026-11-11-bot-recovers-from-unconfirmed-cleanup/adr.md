# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-11
- Reviewer: Claude
- Change: `bot-recovers-from-unconfirmed-cleanup`

## In-Force ADR Context Reviewed

- openspec/adr/0092-bots-use-the-local-docker-compatible-socket.md - Confirmed process-group cleanup stays mandatory. The bot still refuses work until cleanup is confirmed.
- openspec/adr/0093-bots-communicate-through-a-durable-message-log.md - A refused message keeps its failed dispatch record, and the next message is a new post.
- openspec/adr/0096-bots-use-terminay-owned-native-cli-drivers.md - Supervised cleanup through `terminay-run` is unchanged. The retry uses the same `--kill <sid>` command.
- openspec/adr/0028-no-polling-without-owner-approval.md - The retry runs only when new work is requested. No timer or poll is added.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change. Retrying an unconfirmed cleanup before admitting new work refines how ADR-0092 and ADR-0096 are carried out.
