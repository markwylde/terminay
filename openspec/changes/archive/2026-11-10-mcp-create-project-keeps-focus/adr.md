# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-10
- Reviewer: Claude
- Change: mcp-create-project-keeps-focus

## In-Force ADR Context Reviewed

- openspec/adr/0070-an-agents-view-operations-are-applied-by-the-client-it-is-talking-from.md - the channel `create_project` used to show its project; unchanged, now used only by view tools.
- openspec/adr/0072-mcp-reach-is-the-authority-line-and-workspace-reach-controls-the-app.md - `create_project` still needs workspace reach.
- openspec/adr/0100-a-bot-may-hold-workspace-mcp-reach-when-its-owner-opts-it-in.md - bots are among the callers whose project creation no longer moves the view.

## Repository-Level ADRs Created

- openspec/adr/0103-mcp-never-moves-the-users-view-implicitly.md - MCP changes a client's view only through tools whose purpose is the view, or an explicit focus option.

## Notes

ADR-0103 narrows how ADR-0070's channel may be used; it does not supersede it.
