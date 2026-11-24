# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-06
- Reviewer: Claude (with Mark Wylde)
- Change: keep-folder-facts-on-first-show

## In-Force ADR Context Reviewed

- openspec/adr/0049-a-folder-groups-panels-and-is-not-an-identity-boundary.md - folders carry no authority; the memory is keyed by project, not folder
- openspec/adr/0050-a-project-reaches-its-repositorys-worktrees-through-server-resolved-folder-roots.md - roots stay server-resolved; the memory never supplies a root or path for a request

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The per-window listing memory is a tactical renderer cache that seeds a newly mounted folder workspace. It does not change any boundary or contract that future changes depend on.
