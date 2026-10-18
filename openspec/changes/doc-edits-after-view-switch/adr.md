# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-18
- Reviewer: Claude, for Mark Wylde
- Change: doc-edits-after-view-switch

## In-Force ADR Context Reviewed

- openspec/adr/0064-rich-markdown-editing-is-a-file-viewer-view-over-the-panels-own-session.md - saves still go through the panel's own file session; unchanged.
- openspec/adr/0028-no-polling-without-owner-approval.md - the change removes a timer and adds none.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

- The change is a tactical rule inside the rich editor view: which of MDXEditor's change reports are edits. It adds no pattern, boundary, or contract beyond the requirement in `documentation-sidebar-and-editor`.
