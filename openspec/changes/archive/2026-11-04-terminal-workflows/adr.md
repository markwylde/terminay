# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-04
- Reviewer: Claude (with Mark Wylde)
- Change: terminal-workflows

## In-Force ADR Context Reviewed

- openspec/adr/0037-mcp-apps-reach-terminals-through-a-terminay-gateway.md - per-session records drawn over their own terminal; the workflow panel follows the same session binding
- openspec/adr/0072-mcp-reach-is-the-authority-line-and-workspace-reach-controls-the-app.md - workflow tools choose a permission group, need a calling terminal, and need only project reach
- openspec/adr/0074-a-terminals-mcp-capability-follows-it-between-projects-and-never-widens.md - a workflow moves with its terminal and grants no wider reach
- openspec/adr/0075-management-lives-in-one-settings-surface.md - templates are a Settings list-column category, not a window
- openspec/adr/0076-app-window-records-are-server-data-that-last-as-long-as-their-session.md - the record lifetime and persistence applied to workflows unchanged
- openspec/adr/0088-terminay-state-files-are-replaced-durably-and-recovered-by-kind.md - template state and workflow files use durable replacement

## Repository-Level ADRs Created

- openspec/adr/0097-workflows-are-checklists-an-agent-drives-and-terminay-never-runs-a-step.md - workflows are agent-driven status records; Terminay never executes or advances a step

## Notes

- No in-force ADR is superseded.
