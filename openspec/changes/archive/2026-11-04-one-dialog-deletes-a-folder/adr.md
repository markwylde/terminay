# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-22
- Reviewer: Claude (for Mark Wylde)
- Change: one-dialog-deletes-a-folder

## In-Force ADR Context Reviewed

- openspec/adr/0049-a-folder-groups-panels-and-is-not-an-identity-boundary.md - deleting a folder moves or closes panels; no identity or authority change
- openspec/adr/0050-a-project-reaches-its-repositorys-worktrees-through-server-resolved-folder-roots.md - worktree removal stays server-resolved by opaque ID
- openspec/adr/0071-a-running-terminal-always-has-a-place-someone-can-see.md - moved terminals land in General; closed terminals end with their panel, as before

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

Renderer-only consolidation of confirmations; the server's refusals and removal
checks are unchanged.
