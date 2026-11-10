# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-10
- Reviewer: Claude (agent)
- Change: skip-workflow-steps

## In-Force ADR Context Reviewed

- openspec/adr/0097-workflows-are-checklists-an-agent-drives-and-terminay-never-runs-a-step.md - Workflows are status records an agent drives; `skipped` is one more status the agent or user reports, and Terminay still never runs, chooses, or skips a step itself.
- openspec/adr/0098-project-reach-may-curate-workflow-templates-behind-an-asking-group.md - Templates only; skipping acts on an attached workflow and never changes a template.
- openspec/adr/0076-app-window-records-are-server-data-that-last-as-long-as-their-session.md - Workflow records stay server-owned and per-session; the panel's Skip/Restore write through the existing server operation.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

Adding a status value and a user-side caller of the existing `workflow.update-step` operation sits inside ADR-0097's decision. It is not the conditional-step or auto-run behaviour that ADR says would need a superseding ADR.
