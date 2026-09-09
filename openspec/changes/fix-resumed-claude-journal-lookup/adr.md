# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-09
- Reviewer: Mark Wylde
- Change: fix-resumed-claude-journal-lookup

## In-Force ADR Context Reviewed

- openspec/adr/0014-declared-provider-capabilities-proven-against-real-clis.md - the governing record: provider capabilities are proven against the real CLI rather than assumed. This change is an instance of that principle applied in reverse — the real CLI was observed filing a resumed conversation's journal under its origin directory, which the provider had assumed otherwise.
- openspec/adr/0011-security-trust-boundary-model.md - the **Server → extension child** row: the provider reads only through the terminal-scoped observation broker, and this change adds no new capability, path authority, or API surface.
- openspec/adr/0009-server-owned-project-environments.md - observation stays routed through the environment that owns the terminal; nothing here reaches the server host directly.
- openspec/adr/0001, 0002, 0003, 0004, 0005, 0006, 0008, 0010, 0012, 0013, 0015, 0016 - reviewed; runtime baseline, state repository, vault, PTY matrix, client hosts, WebRTC runtime, bundled clients, CI, session host, device approval, signaling exposure, and release archives are untouched.
- openspec/adr/0007-deterministic-pty-runtime-archives.md - superseded by ADR-0008; historical context only.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The decision closest to the bar is resolving a journal by session id instead of by working directory. It reads as new only against the provider's previous assumption; measured against the standing rule it is a correction, not a departure. The identity chain is unchanged — the process's own pid-keyed file names the session and the journal must name it back — and the change is confined to one provider's path resolution, so it establishes nothing future changes need to follow.
