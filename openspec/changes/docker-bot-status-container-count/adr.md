# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-13
- Reviewer: Claude (Opus 5.5)
- Change: docker-bot-status-container-count

## In-Force ADR Context Reviewed

- openspec/adr/0092-bots-use-the-local-docker-compatible-socket.md - one Docker-compatible socket transport for both engines; requires verifying API compatibility for the operations bots use. This change applies that commitment to container listing.
- openspec/adr/0094-bots-attribute-engine-workloads-through-per-bot-proxies.md - engine proxies and ownership labels; unchanged.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

Server-side label exclusion is a tactical fix within ADR-0092's transport, not a new commitment.
