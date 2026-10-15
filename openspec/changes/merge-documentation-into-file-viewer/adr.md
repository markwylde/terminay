# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-16
- Reviewer: Claude (for Mark Wylde)
- Change: merge-documentation-into-file-viewer

## In-Force ADR Context Reviewed

- openspec/adr/0050-a-project-reaches-its-repositorys-worktrees-through-server-resolved-folder-roots.md - file authority follows the server-resolved folder root; its open item keeps MDX runtime and language intelligence on the project root, which this change respects.
- openspec/adr/0049-a-folder-groups-panels-and-is-not-an-identity-boundary.md - one canonical panel per file, whichever folder or view shows it.
- openspec/adr/0009-server-owned-project-environments.md - file sessions and drafts stay server-owned; the Document view uses the existing session contract.

## Repository-Level ADRs Created

- openspec/adr/0064-rich-markdown-editing-is-a-file-viewer-view-over-the-panels-own-session.md - one presentation per file panel; alternative editors are views over the panel's own folder-scoped session.

## Notes

No in-force ADR is superseded. ADR-0050's open item stays open.
