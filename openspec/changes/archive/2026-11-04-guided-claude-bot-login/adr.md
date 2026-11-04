# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-03
- Reviewer: Codex
- Change: guided-claude-bot-login

## In-Force ADR Context Reviewed

- openspec/adr/0091-bots-sign-in-with-their-own-credential.md - per-bot credentials and explicit supported methods; extended narrowly by ADR-0095.
- openspec/adr/0092-bots-use-the-local-docker-compatible-socket.md - continuing engine transport decisions.
- openspec/adr/0093-bots-communicate-through-a-durable-message-log.md - fresh concurrent executions; no provider kept idle for credentials.
- openspec/adr/0094-bots-attribute-engine-workloads-through-per-bot-proxies.md - continuing engine attribution, unchanged by login.

## Repository-Level ADRs Created

- openspec/adr/0095-claude-bots-sign-in-through-their-own-cli.md - extend Claude methods with CLI-owned per-bot browser login.

## Notes

No accepted existing ADR was edited. Native SDK auth command availability requires a focused implementation verification before wiring the manifest.
