# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-16
- Reviewer: Claude (Opus 5.5)
- Change: engine-proxy-flushes-response-headers

## In-Force ADR Context Reviewed

- openspec/adr/0094-bots-attribute-engine-workloads-through-per-bot-proxies.md - the proxy "streams ordinary traffic"; forwarding response heads as soon as they arrive is part of that streaming contract. Attribution, limits, and engine access are unchanged.
- openspec/adr/0092-bots-use-the-local-docker-compatible-socket.md - bots still use the local Docker-compatible socket; in force except the parts ADR-0094 and ADR-0096 supersede.

## Repository-Level ADRs Created

- None: this is a bug fix within the existing proxy design; no durable architectural decision is introduced.

## Notes

The change stays inside the bot container's engine proxy. No Electron privilege, project/window, or terminal-session boundary is touched.
