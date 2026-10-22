# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-22
- Reviewer: Claude (for Mark Wylde)
- Change: open-folder-shell-line

## In-Force ADR Context Reviewed

- openspec/adr/0066-choosing-a-project-root-browses-server-directory-names-under-root-change-authority.md - folders come only from the server's directory-names-only browse query under root-change authority, and the chosen path is revalidated. This change keeps both, and Enter re-browses the target to get the canonical path.
- openspec/adr/0053-in-page-windows-share-one-modal-frame.md - the dialog stays in the shared in-page window frame. The field undoes before the frame's Esc-to-close runs.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

This change only redesigns the UI over the existing browse query. It adds no protocol, IPC, MCP, or authority surface.
