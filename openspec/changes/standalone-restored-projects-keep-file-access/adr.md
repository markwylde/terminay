# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-14
- Reviewer: Claude (Opus 5.5)
- Change: standalone-restored-projects-keep-file-access

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - the filesystem/Git → project-root boundary that restored projects must be re-bound to; it is unchanged.
- openspec/adr/0020-per-operation-canonical-roots.md - binding canonicalizes a root once, and every operation re-resolves it; the startup binding reuses the same resolver.
- openspec/adr/0050-a-project-reaches-its-repositorys-worktrees-through-server-resolved-folder-roots.md - folder roots resolve only for a bound project, so `folders.projectBound` runs for each restored project.
- openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md - in force; it supersedes ADR-0018, which superseded ADR-0008. The fix stays in the server host, and clients and connection hosts do not change.
- openspec/adr/0035-detached-session-holder-owns-ptys.md and openspec/adr/0095-session-holders-retain-bounded-terminal-presentation-in-memory.md - sessions retained by their holder are adopted at restart. Binding a project is independent of its terminals, so retained sessions are unaffected.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The standalone server adopts the existing `workspaceStartup.prepare` hook that Desktop already uses. That brings it into line with the current contract and introduces no new decision.
