# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-04
- Reviewer: Claude (with Mark Wylde)
- Change: mcp-workflow-templates

## In-Force ADR Context Reviewed

- openspec/adr/0097-workflows-are-checklists-an-agent-drives-and-terminay-never-runs-a-step.md - templates vs workflows; nothing is typed except launch/resume text. Honoured: `create_workflow` from a template types nothing.
- openspec/adr/0072-mcp-reach-is-the-authority-line-and-workspace-reach-controls-the-app.md - project reach stops at its project. Partially superseded by ADR-0098.
- openspec/adr/0074-a-terminals-mcp-capability-follows-it-between-projects-and-never-widens.md - terminal resolution for `create_workflow` unchanged.
- openspec/adr/0075-management-lives-in-one-settings-surface.md - templates stay managed in Settings > Workflows; MCP edits the same state.
- openspec/adr/0088-terminay-state-files-are-replaced-durably-and-recovered-by-kind.md - template writes reuse the existing durable file path.
- openspec/adr/0011-security-trust-boundary-model.md - gains the exception recorded in ADR-0098.

## Repository-Level ADRs Created

- openspec/adr/0098-project-reach-may-curate-workflow-templates-behind-an-asking-group.md - project reach may create/update/delete server-wide workflow templates, in a new Ask-by-default Workflow Templates permission group; supersedes ADR-0072 decision 2 in part.

## Notes

- Template order and category management stay Settings-only.
