# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-09
- Reviewer: Claude (Opus 5.5)
- Change: default-convert-eol-off

## In-Force ADR Context Reviewed

- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - supersedes ADR-0008 and keeps protocol-blind hosts; the migration runs in the server settings repository, and hosts only receive the migrated snapshot.
- openspec/adr/0095-session-holders-retain-bounded-terminal-presentation-in-memory.md - the headless presentation checkpoint already uses standard LF semantics; the new default makes live view and checkpoint agree.
- openspec/adr/0101-the-home-overview-layout-is-a-server-setting.md - precedent for server-owned settings in the revisioned snapshot.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

This is a default correction plus a one-time settings migration that uses the existing schema-version mechanism. Neither is a new architectural commitment.
